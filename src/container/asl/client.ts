// A client of the broker socket, for the trusted helpers in a container:
// asl-call, the Node runner, and the Deno host. Programs never import it
// directly; they get a `tools` binding built on it.
import { connect } from "node:net";
import { createInterface } from "node:readline";

export const SOCKET = "/run/asl/broker.sock";

export type Reply = { ok: true; value: unknown; program: boolean } | { ok: false; error: string; refused: boolean };

export type Client = { call(fn: string, args: Record<string, unknown>): Promise<Reply>; close(): void };

export function openClient(path = SOCKET): Promise<Client> {
  return new Promise((resolve, reject) => {
    const sock = connect(path);
    const waiting: ((r: Reply) => void)[] = [];
    let failed: string | null = null;
    sock.on("error", (e) => {
      failed = `the surface is not reachable: ${e.message}`;
      for (const w of waiting.splice(0)) w({ ok: false, error: failed, refused: false });
      reject(new Error(failed));
    });
    sock.on("close", () => {
      failed ??= "the surface closed the connection";
      for (const w of waiting.splice(0)) w({ ok: false, error: failed, refused: false });
    });
    createInterface({ input: sock }).on("line", (line) => waiting.shift()?.(JSON.parse(line) as Reply));
    sock.on("connect", () =>
      resolve({
        call(fn, args) {
          if (failed) return Promise.resolve({ ok: false, error: failed, refused: false });
          return new Promise((r) => {
            waiting.push(r);
            sock.write(`${JSON.stringify({ fn, args })}\n`);
          });
        },
        close: () => sock.end(),
      }),
    );
  });
}
