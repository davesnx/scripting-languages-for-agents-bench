---
name: quickjs-code
description: Write JavaScript programs for the run_code tool, run in a QuickJS sandbox that reaches the task only through the functions of `tools` (bash, read_file, write_file, edit_file). Use when the work must be done in QuickJS code mode.
---

# QuickJS sandbox

You send a JavaScript program to the `run_code` tool. The sandbox, a QuickJS
VM compiled to WebAssembly with no file system, network, timers, or Node
APIs, runs it. The program reaches the task only through the functions of
`tools`, listed above under "The functions of the task". The result is what
the program printed with `text` and `console.log`, then the return value, or
the error that stopped the program.

## How the program runs

- The program is the body of an `async` function: use `await` at the top
  level, and `return` a value to see it in the result. The value of the last
  expression is not the result: without `return`, there is none.
- Plain JavaScript only. TypeScript syntax (type annotations, `as`,
  `interface`, `enum`) is a syntax error, and nothing runs.
- The program itself cannot read or write files, start programs, use the
  network, or read the environment. There is no `fs`, `process`, `fetch`,
  `require`, or `setTimeout`. Every effect on the task goes through `tools`.
- The JavaScript built-ins work: `JSON`, `Math`, `Date`, `RegExp`, `Map`,
  `Set`, `Promise`, classes, generators, string and array methods. `Intl`
  does not.
- Output: `text(value)` adds a text item, `console.log(...)` adds a line, and
  `return value` adds the value. Objects and arrays print as JSON.
- `exit()` ends the program at once, as a success.
- `ALL_TOOLS` lists the functions of `tools` as `{ name, description }`.
  Calling a function that does not exist throws an `Error` whose message
  lists the ones that do.
- Each call starts again. Variables do not stay between calls. What the
  program writes to files stays.
- `tools.bash` does not throw when the command fails: check `exit_code`.
  `output` holds standard output and standard error together.
- The other functions throw an `Error` when the call fails (the message
  starts with `error:`), for example when the file does not exist.
- Await every call. When the program ends, calls still running are
  cancelled, and their results and errors are lost.

## Syntax

```js
let total = 0;
const name = "Ada";
console.log(`Hi ${name}`);
const items = [1, 2];
total += 2;
if (total > 10 && name !== "x") console.log("many");
else if (total > 0) console.log("some");
else console.log("none");
for (const [i, item] of items.entries()) console.log(i, item);
return { total };
```

`text` and `exit` end a program early with a clear result:

```js
const r = await tools.bash({ command: "find dir -name '*.txt'" });
if (r.output === "") {
  text("no text files");
  exit();
}
text(r.output.trim());
console.log(ALL_TOOLS.map((t) => t.name).join(", "));
```

An uncaught error stops the program. The result shows the error and what the
program printed before it.

```js
try {
  await tools.read_file({ path: "missing.txt" });
} catch (e) {
  console.log("could not read:", e.message);
}
```

## Files

```js
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

```js
const r = await tools.bash({ command: "ls dir && grep -c . lines.txt" });
if (r.exit_code !== 0) console.log("failed:", r.exit_code, r.output);
else console.log(r.output);

const sh = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
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

```js
const config = JSON.parse(await tools.read_file({ path: "config.json" }));
config.version = 2;
await tools.write_file({ path: "config.json", content: JSON.stringify(config, null, 2) + "\n" });

const h = await tools.http({ method: "GET", url: "http://127.0.0.1:8080/items" });
if (h.status !== 200) console.log("status", h.status, h.text);
else console.log(JSON.parse(h.text).map((i) => i.name));

const sql = (db, query) =>   // sh: see Commands
  tools.bash({ command: `sqlite3 -json ${sh(db)} <<'SQL'\n${query}\nSQL` });
const q = await sql("/tmp/app.db", "SELECT id, name FROM users LIMIT 5;");
if (q.exit_code !== 0) console.log(q.output);
const users = q.output.trim() ? JSON.parse(q.output) : [];
```

- Call a service of the task with `tools.http`. Only `127.0.0.1` and
  `localhost` answer. A 404 or 503 is a result, not an error: check `status`.
- Send JSON with `body: JSON.stringify(data)` and
  `headers: { "content-type": "application/json" }`. `curl` through `bash`
  also works.
- `sqlite3 -json` prints rows as a JSON list, and nothing when there are no
  rows. Pass SQL on standard input with a quoted heredoc (`<<'SQL'`), so the
  shell changes nothing in it.

## At the same time

Calls that you start before you `await` run at the same time.

```js
const [a, b] = await Promise.all([
  tools.read_file({ path: "a.txt" }),
  tools.bash({ command: "wc -l < lines.txt" }),
]);
const results = await Promise.allSettled(["a.txt", "missing.txt"].map((path) => tools.read_file({ path })));
for (const r of results) console.log(r.status, r.status === "rejected" ? r.reason.message : r.value.trim());
```

`Promise.all` throws at the first call that fails. `Promise.allSettled`
keeps the results of the calls that succeed.

## Method

1. Look first: list the files, read the parts that you will change, and
   check the state.
2. Change one thing, then check the result.
3. Keep the output short: print only the lines and fields that you need.
4. After an error, read the message, fix the cause, and run again.
