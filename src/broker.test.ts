// The broker's tools, run on this machine: bash, read_file, write_file, edit_file.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BASH_OUTPUT_MAX_BYTES } from "./surface.ts";

const dir = mkdtempSync(join(tmpdir(), "asl-broker-"));
process.env.ASL_WORK_DIR = dir;
process.env.ASL_CONFINE = "off";
const { applyEdits, call } = await import("./container/asl/broker.ts");
const ok = async (fn: string, args: Record<string, unknown>) => {
  const r = await call(fn, args);
  assert.ok(r.ok, JSON.stringify(r));
  return r.value;
};

test("bash gives pi's structured result; a failing command is a result", async () => {
  const v = (await ok("bash", { command: "echo hi; exit 3" })) as Record<string, unknown>;
  assert.equal(v.output, "hi\n");
  assert.equal(v.exit_code, 3);
  assert.equal(v.truncated, false);
  assert.equal("full_output_path" in v, false);
  assert.equal(typeof v.wall_time_seconds, "number");
});

test("bash keeps the head and tail of long output, and the whole of it in a file", async () => {
  const v = (await ok("bash", { command: `head -c ${BASH_OUTPUT_MAX_BYTES * 2} /dev/zero | tr '\\0' x; echo END` })) as { output: string; truncated: boolean; full_output_path: string };
  assert.equal(v.truncated, true);
  assert.ok(v.output.length < BASH_OUTPUT_MAX_BYTES + 200);
  assert.match(v.output, /bytes left out/);
  assert.ok(v.output.endsWith("END\n"));
  assert.equal(readFileSync(v.full_output_path, "utf8").length, BASH_OUTPUT_MAX_BYTES * 2 + 4);
});

test("bash stops a command at its timeout, with what it printed", async () => {
  const started = Date.now();
  const v = (await ok("bash", { command: "echo started; sleep 30", timeout: 1 })) as { output: string; exit_code: number };
  assert.ok(Date.now() - started < 5000);
  assert.equal(v.output, "started\n\nCommand timed out after 1 seconds");
  assert.equal(v.exit_code, 137);
});

test("bash returns when the command exits, even if a background process holds the output", async () => {
  const started = Date.now();
  const v = (await ok("bash", { command: "sleep 30 & echo bg" })) as { output: string; exit_code: number };
  assert.ok(Date.now() - started < 5000, "it waited for the background process");
  assert.equal(v.output, "bg\n");
});

test("bash and relative paths start in the work folder", async () => {
  assert.equal(((await ok("bash", { command: "pwd" })) as { output: string }).output, `${dir}\n`);
  await ok("write_file", { path: "rel.txt", content: "r" });
  assert.equal(readFileSync(join(dir, "rel.txt"), "utf8"), "r");
});

test("a process left in the background goes on writing after the call returns", async () => {
  await ok("bash", { command: `(sleep 1; echo hi; touch ${dir}/alive) &` });
  await new Promise((r) => setTimeout(r, 2000));
  assert.equal(existsSync(join(dir, "alive")), true);
});

test("cut output keeps whole UTF-8 characters", async () => {
  const v = (await ok("bash", { command: `for i in $(seq 400000); do printf 'é✓'; done` })) as { output: string; truncated: boolean };
  assert.equal(v.truncated, true);
  assert.equal(v.output.includes("\uFFFD"), false);
});

test("read_file refuses what is not a regular file", async () => {
  const r = await call("read_file", { path: "/dev/zero" });
  assert.ok(!r.ok && /not a regular file/.test(r.error));
});

test("read_file reads whole files, or lines from offset", async () => {
  const p = join(dir, "lines.txt");
  writeFileSync(p, "a\nb\nc\nd\n");
  assert.equal(await ok("read_file", { path: p }), "a\nb\nc\nd\n");
  assert.equal(await ok("read_file", { path: p, offset: 2, limit: 2 }), "b\nc");
  assert.equal(await ok("read_file", { path: p, offset: 3 }), "c\nd\n");
  const missing = await call("read_file", { path: join(dir, "nope") });
  assert.ok(!missing.ok && !missing.refused && /does not exist/.test(missing.error));
});

test("write_file makes folders and says what it wrote", async () => {
  const p = join(dir, "new", "deep", "f.txt");
  assert.equal(await ok("write_file", { path: p, content: "héllo" }), `Successfully wrote 6 bytes to ${p}`);
  assert.equal(readFileSync(p, "utf8"), "héllo");
});

test("edit_file replaces unique text, keeps CRLF and a BOM, and refuses ambiguity", () => {
  assert.equal(applyEdits("a b c", [{ oldText: "b", newText: "B" }, { oldText: "c", newText: "C" }], "f"), "a B C");
  assert.equal(applyEdits("\uFEFFone\r\ntwo\r\n", [{ oldText: "one\ntwo", newText: "1\n2" }], "f"), "\uFEFF1\r\n2\r\n");
  assert.throws(() => applyEdits("x x", [{ oldText: "x", newText: "y" }], "f"), /more than once/);
  assert.throws(() => applyEdits("abc", [{ oldText: "z", newText: "y" }], "f"), /does not occur/);
  assert.throws(() => applyEdits("abcd", [{ oldText: "abc", newText: "" }, { oldText: "cd", newText: "" }], "f"), /overlap/);
});

test("an unknown function is refused; a bad argument is an error", async () => {
  const r = await call("sql", {});
  assert.ok(!r.ok && r.refused);
  const bad = await call("bash", { command: 5 });
  assert.ok(!bad.ok && !bad.refused);
  assert.equal(existsSync(join(dir, "nope")), false);
});
