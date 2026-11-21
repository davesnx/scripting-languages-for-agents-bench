---
name: lua-code
description: Write Lua 5.4 programs for the run_code tool, which reach the task only through the functions of the `tools` table. Use when the work must be done in Lua code mode.
---

# Lua code mode

You send a Lua 5.4 program to the `run_code` tool. The program reaches the
task only through the functions of the global `tools` table, listed above
under "The functions of this task". The result is what the program printed,
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
- A program of the task (such as `tools.sqlite`) does not raise when the
  program fails: check `.code`.
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
local ok2, text = pcall(function() return tools.read_file("notes.txt") end)
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
local text = tools.read_file("README.md")
local n = 0
for line in text:gmatch("[^\n]*\n?") do
  n = n + 1
  if n >= 10 and n <= 20 then io.write(line) end     -- lines 10 to 20
end
local app = tools.read_file("src/app.js")
tools.write_file("src/app.js", (app:gsub("var ", "let ")))
for _, f in ipairs(tools.glob("src/**/*.js")) do
  if tools.read_file(f):find("TODO", 1, true) then print(f) end
end
tools.make_dir("out/2024")
if tools.stat("new.txt") == nil then
  tools.rename_path("old.txt", "new.txt")
end
for _, e in ipairs(tools.list_dir(".")) do
  print(e.type, e.size, e.name)
end
```

- `gsub` gives two values: wrap it in parentheses to pass only the string.
- `read_file` and `write_file` are for text. For other files, use a program
  of the task if it has one (such as a checksum program).
- `rename_path` and `copy_path` never replace a file: they raise if the target exists.
- `remove_path` removes one file, symlink, or empty folder. To remove a folder,
  delete what is in it first.

## JSON, HTTP and SQLite

```lua
local config = json.decode(tools.read_file("config.json"))
config.version = 3
tools.write_file("config.json", json.encode(config, 2) .. "\n")

local r = tools.http("http://127.0.0.1:8080/items")
if r.status ~= 200 then print("status", r.status, r.text) end
local items = json.decode(r.text)
tools.http{ url = "http://127.0.0.1:8080/items", method = "POST",
            headers = { ["Content-Type"] = "application/json" },
            body = json.encode({ name = "x" }) }

local q = tools.sqlite("SELECT id, name FROM users LIMIT 5;")   -- if the task has it
if q.code ~= 0 then print(q.output) end
```

- `json.decode(text)` gives tables: objects keep their key order when you
  encode them again, lists start at 1, and `null` becomes `nil` (the field is
  absent).
- `json.encode(value, indent)` gives one line, or indented lines when you give
  `indent` (such as 2). An empty table encodes as `[]`; use `json.object()` for
  an empty object `{}`. New keys come out in sorted order.
- `http` gives any status as a result. Check `.status`.

## Programs of the task

```lua
local function run(result)
  print(result.output)
  return result.code
end

run(tools.run_tests())
run(tools.git_log({ "main..feature" }))
```

A list argument adds one argument per item. Only the programs listed for
the task exist.

## Method

1. Look first: read the list of functions, list the files, read the parts
   that you will change, and check the state.
2. Change one thing, then check the result.
3. Keep the output short: print only the lines and fields that you need.
4. After an error, read the message and traceback, fix the cause, and run again.
