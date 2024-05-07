import NDK, { NDKEvent, NDKNip46Signer, NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";
import { nip19 } from "nostr-tools";

export function normalizePrivateKey(nsec: string) {
  if (nsec.match(/[0-9a-f]{64}/i)) return nsec;

  try {
    const decode = nip19.decode(nsec);
    if (decode.type === "nsec") return decode.data;
  } catch (error) {}
}

export const USER_MEDIA_SERVERS_KIND: number = 10063;

export function isServerTag(tag: string[]) {
  return (tag[0] === "r" || tag[0] === "server") && tag[1];
}

export function getServersFromEvent(event: NDKEvent) {
  return event.tags.filter(isServerTag).map((t) => t[1]);
}

export async function createNostrConnectSigner(ndk: NDK, connection: string, localKey?: string, relay?: string) {
  if (relay) ndk.addExplicitRelay(relay);

  const localSigner = localKey
    ? new NDKPrivateKeySigner(normalizePrivateKey(localKey))
    : NDKPrivateKeySigner.generate();

  let signer: NDKNip46Signer;

  if (connection.includes("@")) {
    const user = await ndk.getUserFromNip05(connection);
    if (!user?.pubkey) throw new Error("Cant find user");
    console.log("Found user", user.pubkey);

    signer = new NDKNip46Signer(ndk, connection, localSigner);

    signer.remoteUser = user;
    signer.remotePubkey = user.pubkey;
  } else if (connection.startsWith("bunker://")) {
    const uri = new URL(connection);
    const pubkey = uri.host || uri.pathname.replace("//", "");
    const relays = uri.searchParams.getAll("relay");

    if (relays.length === 0) throw new Error("Missing relays");
    signer = new NDKNip46Signer(ndk, pubkey, localSigner);
    signer.relayUrls = relays;
  } else {
    signer = new NDKNip46Signer(ndk, connection, localSigner);
  }

  signer.rpc.on("authUrl", (url: string) => {
    console.log("Got auth url", url);
  });

  await ndk.connect();

  console.log("Connecting to remote signer...");
  await signer.blockUntilReady();
  ndk.signer = signer;

  return { signer, localSigner };
}
