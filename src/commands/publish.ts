import path from "node:path";
import pfs from "node:fs/promises";
import NDK, { NDKEvent, NDKKind, NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";
import { File } from "buffer";

import cli from "../cli.js";
import {
  USER_MEDIA_SERVERS_KIND,
  createNostrConnectSigner,
  getServersFromEvent,
  normalizePrivateKey,
} from "../helpers.js";
// import { DRIVE_KIND, Drive, Upload } from "blossom-drive-sdk";
import { EventTemplate, UnsignedEvent, getEventHash } from "nostr-tools";
import { BlobDescriptor, BlossomClient } from "blossom-client-sdk";

cli.command(
  "publish [pwa]",
  "Upload and publish a .pwa",
  (yargs) => {
    return yargs
      .positional("pwa", {
        describe: "the .pwa file to sign",
        type: "string",
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
      .option("connect-relay", {
        description: "The relay to use for nostr-connect",
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
      .option("servers", {
        alias: "b",
        description: "A list of blossom compatible servers to upload to",
        type: "string",
      })
      .option("drive", {
        alias: "d",
        description: "The blossom drive this file should be added to",
        type: "string",
      })
      .demandOption("pwa")
      .demandOption("relays");
  },
  async (argv) => {
    const buff = await pfs.readFile(argv.pwa);
    const filename = path.basename(argv.pwa);
    const file = new File([buff], filename);

    const mimeType = "application/pwa+zip";

    const relays = argv.relays?.split(",");
    if (!relays || relays.length === 0) throw new Error("Must specify at least one relay");

    const servers =
      argv.servers
        ?.split(",")
        .map((server) => new URL(server.startsWith("http") ? server : "https://" + server).toString()) || [];

    const ndk = new NDK({
      explicitRelayUrls: relays,
      autoFetchUserMutelist: false,
    });

    // create signer
    if (argv.nsec) {
      if (argv.verbose) console.log("Using nsec to sign");
      ndk.signer = new NDKPrivateKeySigner(normalizePrivateKey(argv.nsec));
      await ndk.signer.blockUntilReady();
    } else if (argv.connect) {
      if (argv.verbose) console.log("Using nostr-connect to sign");

      // setup nip-46 signer
      const { signer } = await createNostrConnectSigner(ndk, argv.connect, argv.connectNsec, argv.connectRelay);
      ndk.signer = signer;
    } else {
      // no signer, exit
      throw new Error("Missing nostr connect string or nsec");
    }

    if (argv.verbose) console.log("Connecting to relays");
    await ndk.connect();

    // fetch user profile
    const user = await ndk.signer.user();
    await user.fetchProfile();
    console.log(`Signing as ${user.profile?.displayName} ${user.npub}`);

    // simple signing function
    const signer = async (draft: EventTemplate) => {
      const event: UnsignedEvent = { ...draft, pubkey: user.pubkey };
      const sig = await ndk.signer!.sign(event);
      return { ...event, sig, id: getEventHash(event) };
    };

    if (servers.length === 0) {
      console.log("Looking for users blossom servers");
      const serversEvent = await ndk.fetchEvent({ kinds: [USER_MEDIA_SERVERS_KIND], authors: [user.pubkey] });
      if (!serversEvent) throw new Error("Failed to find servers, please specify some with --servers");

      servers.push(...getServersFromEvent(serversEvent));
    }

    let blob: BlobDescriptor | undefined = undefined;

    if (argv.drive) {
      console.log("Uploading to blossom drive is not implemented yet");
      return process.exit(0);

      // if (argv.verbose) console.log("Looking for drive");
      // const driveEvent = await ndk.fetchEvent({
      //   kinds: [DRIVE_KIND as number],
      //   "#d": [argv.drive],
      //   authors: [user.pubkey],
      // });
      // if (!driveEvent) throw new Error("Failed to find blossom drive " + argv.drive);

      // // simple publisher method
      // const publisher = async (signed: SignedEvent) => {
      //   const event = new NDKEvent(ndk, signed);
      //   await event.publish();
      // };

      // const drive = Drive.fromEvent(driveEvent.rawEvent() as SignedEvent, signer, publisher);
      // const upload = new Upload(drive, "/", servers, signer);

      // // @ts-expect-error
      // await upload.addFile(file);

      // console.log("Starting upload");
      // await upload.upload();

      // TODO: get file id somehow
      // blob = upload.blobs[servers[0]];
    } else {
      const results: BlobDescriptor[] = [];
      // @ts-expect-error
      const auth = await BlossomClient.getUploadAuth(file, signer);
      for (const server of servers) {
        try {
          console.log("Uploading to", server); // @ts-expect-error
          results.push(await BlossomClient.uploadBlob(server, buff, auth));
        } catch (e) {
          console.error("Failed to upload to " + server);
          console.log(e);
        }
      }

      blob = results[0];
    }

    if (!blob) throw new Error("Failed to get blob details");

    if (argv.verbose) console.log("Got response", blob);

    const event = new NDKEvent(ndk);
    event.kind = NDKKind.Media;
    event.content = `${filename}`;

    event.tags.push(["name", file.name]);
    event.tags.push(["size", String(blob.size)]);
    event.tags.push(["m", mimeType]);
    event.tags.push(["x", blob.sha256]);
    event.tags.push(["url", blob.url]);
    // event.tags.push(["magnet", blob.magnet]);
    // event.tags.push(["i", blob.infohash]);
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
);
