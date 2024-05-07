import { WebSocket } from "ws";
import { ReadableStream } from "node:stream/web";

// @ts-expect-error
global.WebSocket = WebSocket;

// @ts-expect-error
ReadableStream.prototype.pipe = ReadableStream.prototype.pipeTo;
