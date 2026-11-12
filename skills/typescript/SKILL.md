---
name: typescript
description: Write TypeScript scripts for the run_script tool. Use when the work must be done with TypeScript scripts on Node.js.
---

# TypeScript

You send a TypeScript script to the `run_script` tool. The tool saves the
script to a `.ts` file and runs it with `node <file>`, in the folder `/work`.
The result is the exit code, then the output: standard output, then standard
error.

## How a script runs

- Node.js 22 runs the file. It removes the types and runs the code. It does
  not check the types. Syntax that is more than types is an error: no `enum`,
  no `namespace`, no parameter properties in a constructor.
- The file is an ES module: use `import`, not `require`. Top-level `await`
  works.
- The Node.js standard library only (`node:fs`, `node:child_process`, ...).
  No npm packages.
- Each call starts a new Node.js process. Variables do not stay between
  calls. Files that a script writes stay.
- The script runs as root in a Linux container (Debian 12). No human can
  answer a prompt. A program that waits for input waits until the time limit.
- There is no internet. Services that the task names on `127.0.0.1` work.
- Programs, through `node:child_process`: `git`, `sqlite3`, `python3`,
  `npm`, `jq`, `curl`, `bash` and coreutils.

## Syntax

```ts
let total: number = 0;
const name = "Ada";
console.log(`Hi ${name}`);
const items: number[] = [1, 2];
const config: { version: number } = { version: 2 };
total += 2;
if (total > 10 && name !== "x") console.log("many");
else if (total > 0) console.log("some");
else console.log("none");
for (const [i, item] of items.entries()) console.log(i, item);
```

An uncaught error stops the script with exit code 1 and a stack trace.

```ts
try {
  readFileSync("missing.txt", "utf8");
} catch (e) {
  console.log("could not read:", (e as Error).message);
}
```

## Files

```ts
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, renameSync, rmSync, copyFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";

const text = readFileSync("README.md", "utf8");
console.log(text.split("\n").slice(9, 20).join("\n"));     // lines 10 to 20
writeFileSync("src/app.js", readFileSync("src/app.js", "utf8").replaceAll("var ", "let "));
appendFileSync("log.txt", "one more line\n");
for (const f of readdirSync("src", { recursive: true }) as string[]) {   // also in subfolders
  if (f.endsWith(".js") && readFileSync(`src/${f}`, "utf8").includes("TODO")) console.log(f);
}
mkdirSync("out/2024", { recursive: true });
renameSync("old.txt", "new.txt");
rmSync("tmp/old-notes.md");
copyFileSync("a.txt", "backup/a.txt");
createHash("sha256").update(readFileSync("photo.jpg")).digest("hex");
```

- `renameSync` replaces a file that is already at the new path. Check with
  `existsSync` first if that matters.
- `readFileSync(path)` with no encoding gives a Buffer, for files that are
  not text.

## Programs

```ts
import { execFileSync, spawnSync } from "node:child_process";

const r = spawnSync("git", ["status", "--short"], { encoding: "utf8" });
console.log(r.status, r.stdout, r.stderr);
execFileSync("npm", ["test"], { stdio: "inherit" });      // throws on failure
```

Give the arguments as a list. Then no shell reads them, and a name with a
space stays one argument.

## JSON, HTTP and SQLite

```ts
const config = JSON.parse(readFileSync("config.json", "utf8"));
writeFileSync("config.json", JSON.stringify(config, null, 2));

const items = await (await fetch("http://127.0.0.1:8080/items")).json();
for (let attempt = 0; attempt < 3; attempt++) {
  const res = await fetch("http://127.0.0.1:8080/upload/a.csv", { method: "POST", body: "x,y\n" });
  console.log(res.status);
  if (res.ok) break;
  await new Promise((r) => setTimeout(r, 2000));
}

const rows = spawnSync("sqlite3", ["-json", "app.db", "SELECT id, name FROM users LIMIT 5;"], { encoding: "utf8" }).stdout;
console.log(JSON.parse(rows || "[]"));
```

`fetch` does not throw for a 4xx or 5xx status. Check `res.ok` or
`res.status`.

## Git

```ts
const git = (...args: string[]) => {
  const r = spawnSync("git", args, { encoding: "utf8" });
  console.log(r.stdout + r.stderr);
  return r.status;
};
git("switch", "-c", "fix-parser");
git("add", "src/a.js", "test/a.test.js");
git("commit", "-m", "Fix the parser");
git("fetch", "origin");
git("push", "origin", "fix-parser");
```

## Method

1. Look first: list the files, read the parts that you will change, and
   check the state (`git status`, a row count, a file list).
2. Change one thing, then check the result.
3. Keep the output short: print only the lines and fields that you need.
4. After an error, read the message, fix the cause, and run again.
