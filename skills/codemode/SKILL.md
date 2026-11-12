---
name: codemode
description: Write TypeScript code for the run_code tool, which calls typed tool functions. Use when the work must be done in code mode.
---

# Code mode

You send TypeScript code to the `run_code` tool. A sandbox runs the code as
the body of an `async` function. The code acts on the machine only through
the functions of `tools`. The result is what the code printed with
`console.log`, then the return value, or the error that stopped the code.

## The tools

```ts
declare const tools: {
  // Runs a command with bash -c in /work.
  run_command(command: string): Promise<{ exit_code: number; output: string }>;
  // Reads a text file. Throws if the file does not exist.
  read_file(path: string): Promise<string>;
  // Writes a text file. Replaces the file if it exists, and makes missing parent folders.
  write_file(path: string, content: string): Promise<void>;
};
```

- Paths are absolute, or start from `/work`.
- `output` holds standard output, then standard error.
- `run_command` does not throw when the command fails. Check `exit_code`.

## How the code runs

- The code is the body of an `async` function: use `await`, and `return` a
  value to see it in the result.
- The sandbox removes the types and runs the code. It does not check the
  types. Syntax that is more than types is an error: no `enum`, no
  `namespace`.
- There is no `import`, `require`, `process`, `fetch`, `setTimeout` or file
  system in the sandbox. The JavaScript built-ins work: `JSON`, `Math`,
  `Date`, `RegExp`, `Map`, `Set`, `Promise`, string and array methods.
- Each call starts again. Variables do not stay between calls. Files that the
  code writes stay.
- The commands run as root in a Linux container (Debian 12). No human can
  answer a prompt. A command that waits for input waits until the time limit.
- There is no internet. Services that the task names on `127.0.0.1` work.
- Programs for `run_command`: `bash`, coreutils, `find`, `grep`, `sed`,
  `git`, `sqlite3`, `python3`, `node`, `npm`, `jq`, `curl`.

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
  await tools.read_file("/work/missing.txt");
} catch (e) {
  console.log("could not read:", (e as Error).message);
}
```

## Files

```ts
const text = await tools.read_file("README.md");
console.log(text.split("\n").slice(9, 20).join("\n"));     // lines 10 to 20
const app = await tools.read_file("src/app.js");
await tools.write_file("src/app.js", app.replaceAll("var ", "let "));
const list = await tools.run_command("find src -name '*.js' -print");
for (const f of list.output.split("\n").filter(Boolean)) {
  if ((await tools.read_file(f)).includes("TODO")) console.log(f);
}
await tools.run_command("mkdir -p out/2024 && mv -n old.txt new.txt");
await tools.run_command("sha256sum photo.jpg");
```

- `read_file` and `write_file` are for text. For other files, use
  commands, such as `cp`, `mv` and `sha256sum`.
- In a command, put single quotes around each name, so that a space or `*`
  stays as typed: `` `rm -- '${name}'` ``. A name with a single quote in it
  needs `'\''` in its place.
- `mv` replaces a file that is already at the new path. `mv -n` never does.

## JSON, HTTP and SQLite

```ts
const config = JSON.parse(await tools.read_file("config.json"));
await tools.write_file("config.json", JSON.stringify(config, null, 2));

const items = JSON.parse((await tools.run_command("curl -sf http://127.0.0.1:8080/items")).output);
for (let attempt = 0; attempt < 3; attempt++) {
  const r = await tools.run_command("curl -sf -X POST --data-binary @a.csv http://127.0.0.1:8080/upload/a.csv");
  if (r.exit_code === 0) break;
  await tools.run_command("sleep 2");
}

const rows = JSON.parse((await tools.run_command("sqlite3 -json app.db 'SELECT id, name FROM users LIMIT 5;'")).output || "[]");
```

`curl -f` gives a non-zero exit code for an HTTP error status.

## Git

```ts
const run = async (command: string) => {
  const r = await tools.run_command(command);
  console.log(r.output);
  return r.exit_code;
};
await run("git status --short --branch");
await run("git switch -c fix-parser");
await run("git add src/a.js test/a.test.js && git commit -m 'Fix the parser'");
await run("git fetch origin");
await run("git push origin fix-parser");
```

## Method

1. Look first: list the files, read the parts that you will change, and
   check the state (`git status`, a row count, a file list).
2. Change one thing, then check the result.
3. Keep the output short: print only the lines and fields that you need.
4. After an error, read the message, fix the cause, and run again.
