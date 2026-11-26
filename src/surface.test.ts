import assert from "node:assert/strict";
import { test } from "node:test";
import { agentsTalk, argumentSchema, BUILTINS, checkArgs, functionsOf, jsonToolSpecs, luaBinding, surfaceDoc, teagentSkill, type Binding } from "./surface.ts";

const fn = (n: string) => functionsOf().find((f) => f.name === n)!;

test("the surface is pi's four coding tools and http", () => {
  assert.deepEqual(functionsOf().map((f) => f.name), ["bash", "read_file", "write_file", "edit_file", "http"]);
  checkArgs(fn("http"), { method: "GET", url: "http://127.0.0.1/", headers: { a: "b" } });
  assert.throws(() => checkArgs(fn("http"), { method: "GET", url: "u", headers: { a: 1 } }), /map names to text/);
});

test("checkArgs enforces names and types of the spec", () => {
  checkArgs(fn("read_file"), { path: "a", offset: 2 });
  assert.throws(() => checkArgs(fn("read_file"), {}), /path is missing/);
  assert.throws(() => checkArgs(fn("read_file"), { path: "a", mode: "x" }), /no parameter mode/);
  assert.throws(() => checkArgs(fn("bash"), { command: "ls", timeout: "5" }), /must be a number/);
  checkArgs(fn("edit_file"), { path: "a", edits: [{ oldText: "x", newText: "y" }] });
  assert.throws(() => checkArgs(fn("edit_file"), { path: "a", edits: [] }), /non-empty list/);
  assert.throws(() => checkArgs(fn("edit_file"), { path: "a", edits: [{ oldText: "x" }] }), /non-empty list/);
});

test("every binding documents every function", () => {
  for (const b of ["typescript", "python", "clank", "teagent", "lua", "psychoscript", "quickjs", "submilli", "vera"] as Binding[]) {
    const doc = surfaceDoc(b);
    for (const f of functionsOf()) assert.match(doc, new RegExp(`\\b${f.name}\\b`), `${b} lacks ${f.name}`);
  }
  assert.match(surfaceDoc("python"), /tools\.read_file\(path: str, offset: float = None, limit: float = None\)/);
  assert.match(surfaceDoc("typescript"), /await tools\.edit_file\(\{ path: string, edits: \{ oldText: string; newText: string \}\[\] \}\)/);
});

test("the JSON tools are the same functions, with required arguments", () => {
  const specs = jsonToolSpecs();
  assert.deepEqual(specs.map((s) => s.name), BUILTINS.map((b) => b.name));
  assert.deepEqual(argumentSchema(fn("bash")).required, ["command"]);
  assert.deepEqual(argumentSchema(fn("read_file")).required, ["path"]);
});

test("agentsTalk relays each function through asl-call with a JSON record", () => {
  const talk = agentsTalk();
  assert.match(talk, /tool bash with command, timeout\n  run 'asl-call' with 'bash', \{"command": command, "timeout": timeout\} within 10 minutes\nend/);
  assert.equal(talk.match(/^tool /gm)?.length, functionsOf().length);
});

test("teagentSkill exposes every function with a record of its parameters", () => {
  const elm = teagentSkill();
  assert.match(elm, /^bash : \{ command : String, timeout : Int \} -> Task Error BashResult$/m);
  assert.match(elm, /^read_file : \{ path : String, offset : Int, limit : Int \} -> Task Error String$/m);
  assert.match(elm, /^edit_file : \{ path : String, edits : List Edit \} -> Task Error String$/m);
  assert.match(elm, /call "edit_file" \(jsonFields \[ \( "path", jsonString args.path \), \( "edits", jsonEdits args.edits \) \]\)/);
});

test("luaBinding defines every function with its parameters in order and their types", () => {
  const lua = luaBinding();
  assert.equal(lua.match(/^define\(/gm)?.length, functionsOf().length);
  assert.match(lua, /^define\("bash", \{ \{ "command", "string" \}, \{ "timeout", "number" \} \}\)$/m);
  assert.match(lua, /^define\("edit_file", \{ \{ "path", "string" \}, \{ "edits", "edits" \} \}\)$/m);
});
