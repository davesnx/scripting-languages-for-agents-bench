---
name: ts-submilli
description: Write Submilli programs for the run_code tool. Submilli is a strict TypeScript subset compiled to WebAssembly; the program reaches the task only through the functions of `@tools`.
---

# Submilli

You send one program to the `run_code` tool. Submilli compiles it to
WebAssembly and runs `main`. The program reaches the task only through the
functions of `@tools`, listed above under "The functions of this task". The
result is what the program logged with `console.log`, then what `main`
returned, or the error that stopped it. A program that does not compile
changes nothing; the compiler's report comes back.

Most of this page comes from Submilli's own prompt for models.

## The program

```ts
import tools from "@tools";

export function main(): string {
    const text = tools.read_file({ path: "README.md" });
    return text.split("\n")[0] ?? "";
}
```

- Export one `function main()` with a return type. Every function
  declaration needs a return type: `function main(): string[]`, never
  `function main()`.
- Programs are synchronous: never `async`, `await` or `Promise`. Every call,
  `tools` included, returns its value directly.
- Programs are typed: never `any`, in an annotation or a cast (`as any`). For
  a value of unknown shape, use `unknown` narrowed with `typeof`,
  `Array.isArray` or `===`.
- Built-ins need no import: `console`, `JSON`, `Math`, `RegExp`, `Map`,
  `Set`, string and array methods. There is no `Date`, `fetch`, `process`,
  `require`, or file system: every effect on the task goes through `tools`.
- Each call starts again. Values do not stay between calls. What the program
  writes with `tools.write_file` stays.

## Rules that models get wrong

- `x == null` is a compile error: write `x === null` or `x === undefined`.
- Missing properties, collection misses, and omitted optional parameters are
  `undefined`; `null` is distinct. `??` handles both.
- `arr[i]` and `obj[key]` read as the element type. Check a missing one where
  you read it (`arr[i] ?? d`, `key in obj`, `arr.at(i)`): an unchecked
  missing read throws `MissingValueError`.
- A local `let x: T;` must be assigned on every path before a read unless `T`
  includes `undefined`.
- Postfix `x!` removes `null` and `undefined` and throws `TypeError` for
  either.
- No runtime reflection: no `.hasOwnProperty()`. Narrow optional fields with
  `obj.field !== undefined`.
- Use `Record<string, V>` or `{ [key: string]: V }` for dynamic `obj[key]`
  reads and writes.
- `namespace` is reserved; `type`, `from`, `of`, `as` and `is` may name
  variables. Reserved words are fine as object keys (`{ type: "x" }`).
- An array you fill needs a type: `const rows: string[] = []`. A callback
  parameter needs none: `rows.filter((row) => row !== "")`.

## Calling the task

- A function of `tools` takes one object with the named fields:
  `tools.read_file({ path: "a.txt" })`, `tools.sqlite({ sql: "SELECT 1" })`.
- A refused call throws `PermissionDeniedError` (its message says
  `refused:`). A failed call, such as a missing file or a target that exists,
  throws `Error` (`error:`). Catch them with `try` and `catch (e)`, and read
  `String(e)`.
- A program of the task does not throw when the program fails: it returns
  `{ code, output }`. Check `code`.
- `stat` gives an object whose fields are `undefined` when nothing is there:
  check `s.type !== undefined`.
- `http` gives `{ status, headers, text }` for any status, and `headers` is a
  list of `{ name, value }`. Check `status`.

## Files

```ts
import tools from "@tools";

export function main(): string[] {
    const changed: string[] = [];
    for (const path of tools.glob({ pattern: "src/**/*.js" })) {
        const text = tools.read_file({ path });
        if (text.includes("var ")) {
            tools.write_file({ path, content: text.replaceAll("var ", "let ") });
            changed.push(path);
        }
    }
    return changed;
}
```

- `list_dir` gives entries `{ name, type, size }`; `type` is `"file"`,
  `"dir"`, `"symlink"` or `"other"`.
- `rename_path` and `copy_path` never replace a file: they throw if the
  target exists.
- `remove_path` removes one file, symlink, or empty folder. To remove a
  folder, remove what is in it first.

## HTTP, JSON and programs of the task

```ts
import tools from "@tools";

type Item = { name: string };

export function main(): string {
    const r = tools.http({ url: "http://127.0.0.1:8080/items", method: "GET" });
    if (r.status !== 200) return `status ${r.status}`;
    const items = JSON.parse(r.text) as Item[];
    const q = tools.sqlite({ sql: "SELECT count(*) FROM users;" });
    if (q.code !== 0) return q.output;
    return `${items.length} items, ${q.output.trim()} users`;
}
```

- `JSON.parse` returns `unknown`. Cast it to a type you declare, as above,
  or narrow it.
- A list field adds one argument per item:
  `tools.git_log({ argv: ["main..feature"] })`. Only the programs listed for
  the task exist.

## Method

1. Look first: one program that lists and reads what you need to plan, and
   returns it.
2. Then one program that makes the change and checks it.
3. Do the work in one program where you can: follow data dependencies in
   code, and return only what the next decision needs.
4. After a compile error, read the report and its `help:` lines, fix only
   that, and send the whole program again.
