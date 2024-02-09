#!/usr/bin/env node
import "websocket-polyfill";
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import fs from "node:fs/promises";
import shell from "shelljs";
import path from "node:path";
import NDK, {
  NDKEvent,
  NDKKind,
  NDKNip46Signer,
  NDKPrivateKeySigner,
} from "@nostr-dev-kit/ndk";
import { uploadFile } from "satellite-cdn-client";
import { nip19 } from "nostr-tools";

if (!shell.which("zip")) {
  shell.echo("Missing zip");
  shell.exit(1);
}

yargs(hideBin(process.argv))
  .command(
    "connect [nostr-connect]",
    "Connect to a nostr-connect string",
    (yargs) => {
      return yargs
        .positional("nostr-connect", { describe: "The nostr-connect string" })
        .demandOption("nostr-connect");
    },
    async (argv) => {
      const ndk = new NDK({
        explicitRelayUrls: ["wss://relay.nsecbunker.com"],
        autoFetchUserMutelist: false,
      });
      const localSigner = NDKPrivateKeySigner.generate();
      const signer = (ndk.signer = new NDKNip46Signer(
        ndk,
        argv.nostrConnect,
        localSigner,
      ));

      await ndk.connect();

      console.log("Connecting to remote signer...");
      await signer.blockUntilReady();

      console.log("Successfully Connected to remote signer");

      console.log("Save the signer key for use later in the publish command:");
      console.log(localSigner.privateKey);

      process.exit(0);
    },
  )
  .command(
    "package [dir]",
    "Package a folder into a .pwa",
    (yargs) => {
      return yargs
        .positional("dir", {
          describe: "the directory to pack",
          default: "./dist",
        })
        .option("app-name", {
          alias: "n",
          type: "string",
          description: "The name of the app",
        })
        .option("app-version", {
          alias: "v",
          type: "string",
          description: "The version of the app",
        })
        .option("package", {
          alias: "p",
          type: "string",
          description: "Get the name and version from a package.json",
        })
        .demandOption("dir");
    },
    async (argv) => {
      let name = "unknown";
      let version = "";

      if (argv.package) {
        const packagePath = path.isAbsolute(argv.package)
          ? argv.package
          : path.relative(process.cwd(), argv.package);

        if (argv.verbose) console.log(`Reading package.json ${packagePath}`);
        const pkg = JSON.parse(await fs.readFile(packagePath));
        name = pkg.name;
        version = pkg.version;
      } else if (argv.appName && argv.appVersion) {
        name = argv.appName;
        version = argv.appVersion;
      } else throw new Error("Missing app-name, app-version or package");

      const output = `${name}_${version.replaceAll(/\./g, "-")}.pwa`;
      if (argv.verbose) console.log(`Packaging ${argv.dir} into ${output}`);

      // remove the old file
      try {
        await fs.stat(output);
        if (argv.verbose) console.log(`Removing existing ${output}`);
        shell.rm(output);
      } catch (e) {}

      // zip folder
      let flags = "rX";
      if (!argv.verbose) flags += "q";
      shell.cd(argv.dir);
      shell.exec(`zip -${flags} ../${output} *`);
      shell.cd("../");

      console.log("Created", output);
    },
  )
  .command(
    "publish [pwa]",
    "Upload and publish a .pwa",
    (yargs) => {
      return yargs
        .positional("pwa", {
          describe: "the .pwa file to sign",
        })
        .option("nsec", {
          description: "The secret key used to sign event",
          type: "string",
        })
        .option("connect", {
          alias: "c",
          description: "A nostr-connect string",
          type: "string",
        })
        .option("connect-nsec", {
          alias: "s",
          description: "The secret key to use for nostr-connect",
          type: "string",
        })
        .option("thumb", {
          description: "A URL to a thumbnail image",
          type: "string",
        })
        .option("relays", {
          alias: "r",
          description: "A comma separated list of relays to publish to",
          type: "string",
        })
        .demandOption("pwa");
    },
    async (argv) => {
      const file = await fs.readFile(argv.pwa);
      const filename = path.basename(argv.pwa);
      file.name = filename;

      const mimeType = "application/pwa+zip";

      const relays = argv.relays?.split(",") ?? [];

      const ndk = new NDK({
        explicitRelayUrls: relays,
        autoFetchUserMutelist: false,
      });
      if (argv.nsec) {
        if (argv.verbose) console.log("Using nsec to sign");
        ndk.signer = new NDKPrivateKeySigner(
          argv.nsec.startsWith("nsec")
            ? nip19.decode(argv.nsec).data
            : argv.nsec,
        );
        await ndk.signer.blockUntilReady();
      } else if (argv.connect) {
        if (argv.verbose) console.log("Using nostr-connect to sign");
        ndk.signer = new NDKNip46Signer(
          ndk,
          argv.connect,
          argv.connectNsec
            ? new NDKPrivateKeySigner(
                argv.connectNsec.startsWith("nsec")
                  ? nip19.decode(argv.connectNsec).data
                  : argv.connectNsec,
              )
            : undefined,
        );

        console.log("Waiting for nostr-connect");
        await ndk.signer.blockUntilReady();
      } else throw new Error("Missing nostr connect string or nsec");

      if (argv.verbose) console.log("Connecting to relays");
      await ndk.connect();

      // fetch user profile
      const user = await ndk.signer.user();
      await user.fetchProfile();
      console.log(`Signing as ${user.profile?.displayName} ${user.npub}`);

      console.log("Uploading file to cdn.satellite.earth");
      const res = await uploadFile(file, async (template) => {
        const e = new NDKEvent(ndk, template);
        await e.sign();
        return e.rawEvent();
      });

      if (argv.verbose) console.log("Got response", res);

      const event = new NDKEvent(ndk);
      event.kind = NDKKind.Media;
      event.content = `${filename}`;

      event.tags.push(["name", res.name]);
      event.tags.push(["size", String(res.size)]);
      event.tags.push(["m", mimeType]);
      event.tags.push(["x", res.sha256]);
      event.tags.push(["url", res.url]);
      event.tags.push(["magnet", res.magnet]);
      event.tags.push(["i", res.infohash]);
      if (argv.thumb) event.tags.push(["thumb", argv.thumb]);
      event.tags.push(["alt", "Packaged PWA"]);

      if (argv.verbose) console.log("Created event", event.rawEvent());

      console.log("Signing Event");
      await event.sign(ndk.signer);

      if (argv.verbose) console.log("Signed Event", event.rawEvent());

      console.log("Publishing event");
      const published = await event.publish();

      console.log("Published", event.id, "nostr:" + event.encode());
      console.log("To relays:");
      for (const relay of published) console.log("  " + relay.url);

      process.exit(0);
    },
  )
  .option("verbose", {
    type: "boolean",
    description: "Run with verbose logging",
  })
  .demandCommand(1)
  .help("h")
  .alias("h", "help")
  .parse();
