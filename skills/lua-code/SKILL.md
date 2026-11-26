---
name: lua-code
description: Write Lua 5.4 programs for the run_code tool, which reach the task only through the functions of the `tools` table. Use when the work must be done in Lua code mode.
---

# Lua code mode

You send a Lua 5.4 program to the `run_code` tool. The program reaches the
task only through the functions of the global `tools` table, listed above
under "The functions of the task". The result is what the program printed,
then the value it returned, or the error and traceback that stopped it.

## How a program runs

- Each call starts a new interpreter. Variables do not stay between calls.
  What the program writes with `tools.write_file` stays.
- The standard library works for computing: `string`, `table`, `math`,
  `utf8`, `os.time` and `os.date`. The global `json` encodes and decodes
  JSON. There are no other libraries.
- The program itself cannot reach the task: `io.open`, `io.popen` and
  `os.execute` run on a machine that has no task files and no network.
  Every effect on the task goes through `tools`.
- A function of `tools` raises an error when the call is refused (the
  message starts with `refused:`) or fails (`error:`). An uncaught error
  stops the program.
- `tools.bash` does not raise when the command fails: check `.exit_code`.
- Give the arguments in the listed order, `tools.read_file("a.txt")`, or as
  one table of named arguments, `tools.write_file{ path = "a.txt", content = "x" }`.

## Syntax

```lua
local total = 0
local name = "Ada"
print(string.format("Hi %s, %d items", name, 3))
print("Hi " .. name)                     -- .. joins strings
local items = { "a", "b" }               -- lists start at 1
local config = { version = 2 }
total = total + 2                        -- no +=
if total > 10 and name ~= "x" then       -- ~= is "not equal"
  print("many")
elseif total > 0 then
  print("some")
else
  print("none")
end
for i, item in ipairs(items) do print(i, item) end
for key, value in pairs(config) do print(key, value) end
print(#items)                            -- length of a list or string
local function double(x) return x * 2 end
print(double(21), 7 // 2, 7 % 2, 2 ^ 10)
```

`nil` and `false` are false; `0` and `""` are true. Use `local` for every
variable. Catch an error with `pcall`:

```lua
local ok, err = pcall(tools.read_file, "missing.txt")
if not ok then print("could not read: " .. err) end
local ok2, text = pcall(function() return tools.read_file("a.txt") end)
if ok2 then print(#text) end
```

## Strings

Lua has no regular expressions. Its patterns use `%` instead of `\`:
`%d` digit, `%s` space, `%w` letter or digit, `%a` letter, `.` any character,
`-` shortest repeat. Escape `( ) . % + - * ? [ ] ^ $` with `%`.

```lua
local s = "  Name: Ada, Age: 36  "
local trimmed = s:match("^%s*(.-)%s*$")
local age = tonumber(s:match("Age: (%d+)"))
print(s:find("Ada", 1, true))            -- true: plain text, no pattern
print(s:gsub("Ada", "Bo"))               -- new string and the count
print(s:upper(), s:sub(3, 6), s:rep(2, ","))
local lines = {}
for line in ("a\nb\n"):gmatch("[^\n]+") do lines[#lines + 1] = line end
local fields = {}
for field in ("x,y,,z"):gmatch("([^,]*)") do fields[#fields + 1] = field end
print(table.concat(lines, ";"), #fields)
print(("a.b"):gsub("%.", "/"))           -- escape . to match it
```

## Lists and tables

```lua
local xs = { 3, 1, 2 }
table.insert(xs, 4)                      -- append
xs[#xs + 1] = 5                          -- append
table.remove(xs, 1)                      -- remove the first
table.sort(xs)
table.sort(xs, function(a, b) return a > b end)
print(table.concat(xs, ", "))
local seen = {}
for _, x in ipairs(xs) do seen[x] = true end
if seen[2] then print("has 2") end
local count = 0
for _ in pairs(seen) do count = count + 1 end
print(count)
```

## Files

```lua
local part = tools.read_file("README.md", 10, 11)        -- lines 10 to 20
io.write(part)
local app = tools.read_file("src/app.js")
tools.write_file("src/app.js", (app:gsub("var ", "let ")))
tools.edit_file("src/app.js", {
  { oldText = "let a = 1;", newText = "let a = 2;" },
})
local found = tools.bash("grep -rl --include='*.js' TODO src")
for path in found.output:gmatch("[^\n]+") do print(path) end
print(tools.bash("ls -la").output)
local mv = tools.bash("test -e new.txt || mv old.txt new.txt")
if mv.exit_code ~= 0 then print(mv.output) end
```

- `gsub` gives two values: wrap it in parentheses to pass only the string.
- `read_file(path, offset, limit)` reads `limit` lines from line `offset`
  (the first line is 1).
- `edit_file` replaces exact text. Each `oldText` must occur exactly once in
  the file, or the call raises and nothing changes. Read the file first and
  copy the text with its spaces.
- `write_file` replaces the whole file and makes missing folders.
- Listing, finding, moving, copying and removing files go through `bash`:
  `ls`, `find`, `grep -rl`, `mv`, `cp`, `rm`, `mkdir -p`.
- `read_file` and `write_file` are for text. Handle other files with a
  program through `bash`, such as `sha256sum`.
- Put temporary files in `/tmp`, not in `/work`.

## Commands, JSON, HTTP and SQLite

```lua
local r = tools.bash("git status --short")
if r.exit_code ~= 0 then print(r.output) end

local config = json.decode(tools.read_file("config.json"))
config.version = 3
tools.write_file("config.json", json.encode(config, 2) .. "\n")

local h = tools.bash("curl -sS -w '\\n%{http_code}' http://127.0.0.1:8080/items")
local body, status = h.output:match("^(.*)\n(%d+)$")
if status ~= "200" then print("status", status, body) end
local items = json.decode(body)
tools.bash("curl -sS -X POST -H 'Content-Type: application/json' " ..
           "--data-binary @- http://127.0.0.1:8080/items <<'EOF'\n" ..
           json.encode({ name = "x" }) .. "\nEOF")

local q = tools.bash("sqlite3 -json app.db 'SELECT id, name FROM users LIMIT 5;'")
if q.exit_code ~= 0 then error(q.output) end
local rows = q.output == "" and {} or json.decode(q.output)
for _, row in ipairs(rows) do print(row.id, row.name) end
tools.bash([[sqlite3 app.db <<'SQL'
UPDATE users SET name = 'Al''s' WHERE id = 1;
SQL]])
```

- `bash` does not raise when the command fails: check `.exit_code`.
  `.output` holds standard output and standard error together.
- A long output is cut in the middle: then `.truncated` is true and
  `.full_output_path` names a file with all of it. Keep output short with
  `head`, `grep` or `wc -l` in the command.
- `curl` exits 0 for any HTTP status. Ask for the status with
  `-w '\n%{http_code}'`, as above, and check it. Use `-f` to make a status
  of 400 or more an exit code.
- Only services on `127.0.0.1` or `localhost` answer. Wait for one with a
  loop in the command: `for i in $(seq 30); do curl -sf URL && break; sleep 1; done`.
- `sqlite3 -json` gives a JSON list of rows, and nothing at all (not `[]`)
  when there are no rows. Pass longer SQL on standard input with a heredoc,
  as above: quotes inside it need no escaping for bash.
- Check that a program exists with `command -v name` before you rely on it.
- `json.decode(text)` gives tables: objects keep their key order when you
  encode them again, lists start at 1, and `null` becomes `nil` (the field is
  absent).
- `json.encode(value, indent)` gives one line, or indented lines when you give
  `indent` (such as 2). An empty table encodes as `[]`; use `json.object()` for
  an empty object `{}`. New keys come out in sorted order.
- Calls run one at a time, in order.

## Method

1. Look first: list the files with `bash`, read the parts that you will
   change, and check the state.
2. Change one thing, then check the result.
3. Keep the output short: print only the lines and fields that you need.
4. After an error, read the message and traceback, fix the cause, and run again.
