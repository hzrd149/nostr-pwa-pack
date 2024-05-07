import NDK from "@nostr-dev-kit/ndk";

import cli from "../cli.js";
import { createNostrConnectSigner } from "../helpers.js";

cli.command(
  "connect [nostr-connect]",
  "Connect to a nostr-connect string",
  (yargs) => {
    return yargs
      .positional("nostr-connect", { describe: "The nostr-connect string", type: "string" })
      .option("relay", {
        type: "string",
      })
      .demandOption("nostr-connect");
  },
  async (argv) => {
    const ndk = new NDK({
      explicitRelayUrls: ["wss://relay.nsecbunker.com"],
      autoFetchUserMutelist: false,
    });

    const { localSigner } = await createNostrConnectSigner(ndk, argv.nostrConnect, undefined, argv.relay);

    console.log("Successfully Connected to remote signer");

    console.log("Save the signer key for use later in the publish command:");
    console.log("================================================================");
    console.log(localSigner.privateKey);
    console.log("================================================================");

    process.exit(0);
  },
);
