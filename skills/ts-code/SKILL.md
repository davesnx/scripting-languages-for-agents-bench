---
name: ts-code
description: Write TypeScript code for the run_code tool, which reaches the task only through the functions of `tools` (bash, read_file, write_file, edit_file). Use when the work must be done in TypeScript code mode.
---

# TypeScript code mode

You send TypeScript code to the `run_code` tool. The code is the body of an
`async` function. It reaches the task only through the functions of `tools`,
listed above under "The functions of the task". The result is what the code
printed with `console.log`, then the return value, or the error that stopped
the code.

## How the code runs

- The code is the body of an `async` function: use `await`, and `return` a
  value to see it in the result.
- Types are removed, not checked. Syntax that is more than types is an
  error: no `enum`, no `namespace`.
- The code itself cannot read or write files, start programs, use the
  network, or read the environment. `fs`, `child_process`, `fetch` and
  `Deno.*` either do not exist or reach nothing of the task. Every effect on
  the task goes through `tools`.
- The JavaScript built-ins work: `JSON`, `Math`, `Date`, `RegExp`, `Map`,
  `Set`, `Promise`, string and array methods.
- Each call starts again. Variables do not stay between calls. What the code
  writes to files stays.
- `tools.bash` does not throw when the command fails: check `exit_code`.
  `output` holds standard output and standard error together.
- The other functions throw an `Error` when the call fails (the message
  starts with `error:`), for example when the file does not exist.
- `await` every call. A command still running when the code ends is stopped.

## Syntax

```ts
let total: number = 0;
const name = "Ada";
console.log(`Hi ${name}`);
const items: number[] = [1, 2];
total += 2;
if (total > 10 && name !== "x") console.log("many");
else if (total > 0) console.log("some");
else console.log("none");
for (const [i, item] of items.entries()) console.log(i, item);
return { total };
```

An uncaught error stops the code. The result shows the error.

```ts
try {
  await tools.read_file({ path: "missing.txt" });
} catch (e) {
  console.log("could not read:", (e as Error).message);
}
```

## Files

```ts
const text = await tools.read_file({ path: "lines.txt" });
console.log(await tools.read_file({ path: "lines.txt", offset: 2, limit: 2 }));   // lines 2 and 3
await tools.write_file({ path: "src/app.js", content: "var a = 1;\nvar b = 2;\n" });
await tools.edit_file({ path: "src/app.js", edits: [
  { oldText: "var a = 1;", newText: "let a = 1;" },
  { oldText: "var b", newText: "let b" },
] });
const app = await tools.read_file({ path: "src/app.js" });
await tools.write_file({ path: "src/app.js", content: app.replaceAll("let ", "const ") });
const found = await tools.bash({ command: "find src -type f -name '*.js'" });
for (const f of found.output.split("\n").filter(Boolean)) {
  if ((await tools.read_file({ path: f })).includes("TODO")) console.log(f);
}
```

- `read_file` and `write_file` are for text. For other files, use a program
  through `bash` (such as `sha256sum`).
- Each `oldText` of `edit_file` must occur exactly once in the file. If one
  does not, nothing changes and the call throws. Add lines around the text to
  make it unique.
- `write_file` replaces the whole file and makes missing parent folders.
- List, move, copy and remove files with `bash`: `find`, `ls`, `mv -n`,
  `cp`, `rm`, `mkdir -p`.
- Put temporary files in `/tmp`.

## Commands

```ts
const r = await tools.bash({ command: "ls dir && grep -c . lines.txt" });
if (r.exit_code !== 0) console.log("failed:", r.exit_code, r.output);
else console.log(r.output);

const sh = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
const name = "my notes.txt";
await tools.write_file({ path: name, content: "x\n" });
await tools.bash({ command: `mkdir -p out/2024 && mv -n -- ${sh(name)} out/2024/` });
```

- Each `tools.bash` call starts a new `bash` in `/work`. `cd` and
  variables do not stay between calls.
- Quote every value that you put in a command, as `sh` does above.
  `JSON.stringify` does not quote for the shell.
- `grep` that finds nothing gives exit code 1. That is not always an error.
- Give `timeout` (in seconds) to a command that may hang.

## JSON, HTTP and SQLite

```ts
const config = JSON.parse(await tools.read_file({ path: "config.json" }));
config.version = 2;
await tools.write_file({ path: "config.json", content: JSON.stringify(config, null, 2) + "\n" });

const r = await tools.bash({ command: "curl -s -w '\\n%{http_code}' http://127.0.0.1:8099/index.html" });
const status = Number(r.output.slice(r.output.lastIndexOf("\n") + 1));
const body = r.output.slice(0, r.output.lastIndexOf("\n"));
if (status !== 200) console.log("status", status, body);

const sql = (db: string, query: string) =>   // sh: see Commands
  tools.bash({ command: `sqlite3 -json ${sh(db)} <<'SQL'\n${query}\nSQL` });
const q = await sql("/tmp/app.db", "SELECT id, name FROM users LIMIT 5;");
if (q.exit_code !== 0) console.log(q.output);
const users: { id: number; name: string }[] = q.output.trim() ? JSON.parse(q.output) : [];
```

- `curl -s` succeeds on 404 and 503. Print the status with
  `-w '%{http_code}'`, or use `-f` to get a non-zero exit code.
- Send a JSON body with `curl -s -X POST -H 'Content-Type: application/json'
  --data-binary @/tmp/body.json URL`, after `write_file` of `/tmp/body.json`.
- `sqlite3 -json` prints rows as a JSON list, and nothing when there are no
  rows. Pass SQL on standard input with a quoted heredoc (`<<'SQL'`), so the
  shell changes nothing in it.

## At the same time

Calls that you start before you `await` run at the same time.

```ts
const [a, b] = await Promise.all([
  tools.read_file({ path: "a.txt" }),
  tools.bash({ command: "wc -l < lines.txt" }),
]);
const results = await Promise.allSettled(["a.txt", "missing.txt"].map((path) => tools.read_file({ path })));
for (const r of results) console.log(r.status, r.status === "rejected" ? (r.reason as Error).message : r.value.trim());
```

`Promise.all` throws at the first call that fails. `Promise.allSettled`
keeps the results of the calls that succeed.

## Method

1. Look first: list the files, read the parts that you will change, and
   check the state.
2. Change one thing, then check the result.
3. Keep the output short: print only the lines and fields that you need.
4. After an error, read the message, fix the cause, and run again.
