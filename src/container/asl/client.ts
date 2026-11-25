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
    // The broker answers each call when it finishes, so concurrent calls can be
    // answered out of order: match each reply to its call by id.
    const waiting = new Map<number, (r: Reply) => void>();
    let next = 0;
    const failAll = (error: string) => {
      for (const w of waiting.values()) w({ ok: false, error, refused: false });
      waiting.clear();
    };
    let failed: string | null = null;
    sock.on("error", (e) => {
      failed = `the surface is not reachable: ${e.message}`;
      failAll(failed);
      reject(new Error(failed));
    });
    sock.on("close", () => {
      failed ??= "the surface closed the connection";
      failAll(failed);
    });
    createInterface({ input: sock }).on("line", (line) => {
      const { id, ...reply } = JSON.parse(line) as Reply & { id?: number };
      const w = id === undefined ? undefined : waiting.get(id);
      if (!w) return;
      waiting.delete(id as number);
      w(reply as Reply);
    });
    sock.on("connect", () =>
      resolve({
        call(fn, args) {
          if (failed) return Promise.resolve({ ok: false, error: failed, refused: false });
          return new Promise((r) => {
            const id = ++next;
            waiting.set(id, r);
            sock.write(`${JSON.stringify({ id, fn, args })}\n`);
          });
        },
        close: () => sock.end(),
      }),
    );
  });
}
