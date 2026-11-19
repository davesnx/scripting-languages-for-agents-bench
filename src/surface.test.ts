import assert from "node:assert/strict";
import { test } from "node:test";
import { agentsTalk, checkArgs, expandArgv, functionsOf, surfaceDoc, teagentSkill, type TaskSurface } from "./surface.ts";
import { importTalk, neutralDoc } from "./talk-import.ts";

const TALK = `allow env PATH, HOME
allow fetch from http://127.0.0.1:8081/

# Makes an archive (tar), such as archive_project 'a.tgz', 'site'.
tool archive_project with archive, project
  run 'tar' with '--create', '--file=archive/' + archive, '--', project within 2 minutes
end

# Runs git with the given arguments.
tool run_git with argv
  run 'rungit' with argv within 1 minute
end

tool sqlite with sql
  run 'sqlite3' with '-bail', @/shop.db, sql within 1 minute
end

tool run_tests
  run 'npm test' within 2 minutes
end
`;

test("importTalk reads services, tools, argv templates and timeouts", () => {
  const s = importTalk(TALK, "t");
  assert.deepEqual(s.services, ["http://127.0.0.1:8081/"]);
  assert.deepEqual(
    s.tools.map((t) => [t.name, t.params, t.argv, t.timeoutSeconds]),
    [
      ["archive_project", [{ name: "archive", type: "string" }, { name: "project", type: "string" }], ["tar", "--create", { concat: ["--file=archive/", { param: "archive" }] }, "--", { param: "project" }], 120],
      ["run_git", [{ name: "argv", type: "strings" }], ["rungit", { param: "argv" }], 60],
      ["sqlite", [{ name: "sql", type: "string" }], ["sqlite3", "-bail", "/work/shop.db", { param: "sql" }], 60],
      ["run_tests", [], ["npm", "test"], 120],
    ],
  );
  assert.equal(s.tools[0]?.doc, "Makes an archive (tar).");
  assert.equal(s.tools[3]?.doc, "Runs npm.");
});

test("neutralDoc drops ClankTalk call examples and keeps the rest", () => {
  assert.equal(neutralDoc("Moves one file, with mv, such as move_file 'a', 'b'. Like mv, it replaces.", "move_file"), "Moves one file, with mv. Like mv, it replaces.");
  assert.equal(neutralDoc("A spec, such as '2027-03-02'.", "tz_date"), "A spec, such as '2027-03-02'.");
});

test("importTalk refuses what it cannot read", () => {
  assert.throws(() => importTalk("tool x with a\n  run 'p' with b within 1 minute\nend\n", "t"), /unknown name b/);
  assert.throws(() => importTalk("something else\n", "t"), /cannot import/);
});

const surface: TaskSurface = importTalk(TALK, "t");
const tool = (name: string) => surface.tools.find((t) => t.name === name)!;

test("expandArgv spreads lists, concatenates, and keeps literal options fixed", () => {
  assert.deepEqual(expandArgv(tool("archive_project"), { archive: "a.tgz", project: "-rf" }), ["tar", "--create", "--file=archive/a.tgz", "--", "-rf"]);
  assert.deepEqual(expandArgv(tool("run_git"), { argv: ["log", "--oneline"] }), ["rungit", "log", "--oneline"]);
  assert.deepEqual(expandArgv(tool("run_git"), { argv: "status" }), ["rungit", "status"]);
  assert.deepEqual(expandArgv(tool("run_git"), {}), ["rungit"]);
  assert.throws(() => expandArgv(tool("archive_project"), { archive: ["a", "b"], project: "x" }), /one text value/);
});

test("checkArgs enforces names and types of the spec", () => {
  const fns = functionsOf(surface);
  const fn = (n: string) => fns.find((f) => f.name === n)!;
  checkArgs(fn("read_file"), { path: "a" });
  assert.throws(() => checkArgs(fn("read_file"), {}), /path is missing/);
  assert.throws(() => checkArgs(fn("read_file"), { path: "a", mode: "x" }), /no parameter mode/);
  assert.throws(() => checkArgs(fn("http"), { url: "u", headers: { a: 1 } }), /map names to text/);
  checkArgs(fn("sqlite"), {});
});

test("every binding documents the same functions", () => {
  for (const b of ["typescript", "python", "clank", "teagent"] as const) {
    const doc = surfaceDoc(b, surface);
    for (const f of functionsOf(surface)) assert.match(doc, new RegExp(`\\b${f.name}\\b`), `${b} lacks ${f.name}`);
    assert.match(doc, /127\.0\.0\.1:8081/);
  }
});

test("agentsTalk relays each function through asl-call with a JSON record", () => {
  const talk = agentsTalk(surface);
  assert.match(talk, /tool archive_project with archive, project\n  run 'asl-call' with 'archive_project', \{"archive": archive, "project": project\} within 2 minutes\nend/);
  assert.match(talk, /tool run_tests\n  run 'asl-call' with 'run_tests', \{\} within 2 minutes/);
  assert.doesNotMatch(talk, /allow fetch/);
  assert.equal(talk.match(/^tool /gm)?.length, functionsOf(surface).length);
});

test("teagentSkill exposes every function with a record of its parameters", () => {
  const elm = teagentSkill(surface);
  for (const f of functionsOf(surface)) assert.match(elm, new RegExp(`^${f.name} : `, "m"), `missing ${f.name}`);
  assert.match(elm, /^archive_project : \{ archive : String, project : String \} -> Task Error Outcome$/m);
  assert.match(elm, /^run_git : \{ argv : List String \} -> Task Error Outcome$/m);
  assert.match(elm, /^run_tests : \(\) -> Task Error Outcome$/m);
  assert.match(elm, /call "run_tests" \("\{\}"\)/);
  assert.match(elm, /^glob : \{ pattern : String \} -> Task Error \(List String\)$/m);
  assert.match(elm, /call "archive_project" \(jsonFields \[ \( "archive", jsonString args.archive \), \( "project", jsonString args.project \) \]\)/);
});
