import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { posix } from "node:path";

export type ExecResult = { code: number; stdout: string; stderr: string };
export type Manifest = Map<string, string>;

export interface Sandbox {
  exec(command: string[], input?: string): Promise<ExecResult>;
  open(command: string[], env: Record<string, string>): ChildProcessWithoutNullStreams;
  copyIn(hostPath: string, containerPath: string): Promise<void>;
  snapshot(roots: string[]): Promise<Manifest>;
  destroy(): Promise<void>;
}

function docker(args: string[], input?: string): Promise<{ code: number; stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (b: Buffer) => out.push(b));
    child.stderr.on("data", (b: Buffer) => err.push(b));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString() }));
    child.stdin.end(input ?? "");
  });
}

async function dockerOk(args: string[]): Promise<Buffer> {
  const r = await docker(args);
  if (r.code !== 0) throw new Error(`docker ${args.slice(0, 2).join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout;
}

export async function startDocker(image: string): Promise<Sandbox> {
  const name = `asl-bench-${randomBytes(6).toString("hex")}`;
  await dockerOk(["run", "-d", "--rm", "--name", name, "--label", "asl-bench=1", "--network", "none", "--memory", "2g", "--pids-limit", "4096", image, "sleep", "infinity"]);
  return {
    async exec(command, input) {
      const r = await docker(["exec", "-i", name, ...command], input);
      return { code: r.code, stdout: r.stdout.toString(), stderr: r.stderr };
    },
    open(command, env) {
      const envArgs = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
      return spawn("docker", ["exec", "-i", ...envArgs, name, ...command], { stdio: ["pipe", "pipe", "pipe"] });
    },
    async copyIn(hostPath, containerPath) {
      await dockerOk(["exec", name, "mkdir", "-p", posix.dirname(containerPath)]);
      await dockerOk(["cp", hostPath, `${name}:${containerPath}`]);
    },
    async snapshot(roots) {
      const manifest: Manifest = new Map();
      for (const root of roots) {
        const r = await docker(["cp", `${name}:${root}`, "-"]);
        if (r.code !== 0) {
          if (/No such container:path|Could not find the file/i.test(r.stderr)) continue;
          throw new Error(`snapshot of ${root} failed: ${r.stderr.trim()}`);
        }
        readTar(r.stdout, posix.dirname(root), manifest);
      }
      return manifest;
    },
    async destroy() {
      await docker(["rm", "-f", name]);
    },
  };
}

function field(header: Buffer, start: number, length: number): string {
  const raw = header.subarray(start, start + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? length : end).toString("utf8");
}

function paxRecords(data: Buffer): Record<string, string> {
  const records: Record<string, string> = {};
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space === -1) break;
    const length = Number(data.subarray(offset, space).toString());
    if (!length) break;
    const record = data.subarray(space + 1, offset + length - 1).toString("utf8");
    const eq = record.indexOf("=");
    records[record.slice(0, eq)] = record.slice(eq + 1);
    offset += length;
  }
  return records;
}

function readTar(tar: Buffer, base: string, manifest: Manifest): void {
  let offset = 0;
  let pax: Record<string, string> = {};
  let longName: string | null = null;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const size = parseInt(field(header, 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(header[156] ?? 0);
    const data = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === "x") {
      pax = paxRecords(data);
      continue;
    }
    if (type === "g") continue;
    if (type === "L") {
      longName = data.toString("utf8").replace(/\0+$/, "");
      continue;
    }
    const prefix = field(header, 345, 155);
    const name = pax.path ?? longName ?? (prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100));
    const link = pax.linkpath ?? field(header, 157, 100);
    const mode = (parseInt(field(header, 100, 8).trim() || "0", 8) & 0o7777).toString(8);
    pax = {};
    longName = null;
    const path = posix.join(base, name.replace(/\/$/, ""));
    if (type === "0" || type === "\0" || type === "7") manifest.set(path, `file ${mode} ${createHash("sha256").update(data).digest("hex")}`);
    else if (type === "2") manifest.set(path, `symlink ${link}`);
    else if (type === "1") manifest.set(path, `hardlink ${link}`);
  }
}

function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i++;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export const HARNESS_PATHS = ["/work/.talk/**", "/work/AGENTS.talk"];

export function damage(before: Manifest, after: Manifest, allowed: string[]): string[] {
  const ok = [...allowed, ...HARNESS_PATHS].map(globToRegExp);
  const changes: string[] = [];
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(path);
    const b = after.get(path);
    if (a === b || ok.some((re) => re.test(path))) continue;
    changes.push(`${a === undefined ? "added" : b === undefined ? "removed" : "changed"} ${path}`);
  }
  return changes.sort();
}
