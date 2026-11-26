---
name: teagent-code
description: Write Dartea programs for the teagent run tool, which reach the task only through the functions of the `Surface` module. Use when the work must be done in Dartea code mode.
---

# Dartea code mode (teagent)

You send one program to the `run` tool. The program is written in Dartea, a
pure dialect of Elm 0.19.1. teagent typechecks the whole program before
anything runs. If it does not compile, nothing runs, and the compiler report
comes back, often with a `Hint:` line. Fix the program and send it again.

A program cannot do anything by itself. `main` is a value of type
`Task e a`: a description of work. teagent carries it out, and gives back
the value of `main` in Elm syntax. The program reaches the task only through
the functions of the `Surface` module, listed above under "The functions of
the task".

## The program

```elm
module Main exposing (main)

import Agent exposing (..)
import Surface exposing (..)


main : Task Error String
main =
    read_file { path = "README.md", offset = 0, limit = 0 }
```

- One module, `Main`, that exposes `main`. Import `Agent exposing (..)` for
  `succeed`, `andThen`, `map` and the rest, and `Surface exposing (..)` for
  the functions of the task.
- Core modules: `Basics`, `List`, `Maybe`, `Result`, `String`, `Char`,
  `Tuple`, `Dict`, `Set`, and `List.unique`. There is no `Debug`, `Json`,
  `Regex`, `Time`, `Random`, `Html`, `Task` module, and no `List.Extra`.
- Write Agent functions without a prefix: `succeed`, `andThen`, `map`. Not
  `Task.succeed`, not `Task.andThen`.
- `port`, `type`, `as` and `where` cannot name a value, an argument or a
  record field. Write `port_`, not `port`. The kind of a file is `.kind`.

## How a program runs

- Each run starts again. Values do not stay between runs. What the program
  writes with `write_file` stays.
- `Agent` here has only `shell`, and it runs in an empty folder of a machine
  that has no task files and no network. It cannot reach the task. Every
  effect on the task goes through `Surface`.
- A `Surface` function takes one record with every field named, and gives
  a `Task Error a`. Give 0 for a number you leave out:
  `bash { command = "ls -la", timeout = 0 }`,
  `read_file { path = "a.txt", offset = 0, limit = 0 }`. A refused call
  fails with `Refused message`; a failed one (a missing file, an `oldText`
  that is not in the file) with `Failed message`.
- `bash` does not fail when the command fails: it gives a `BashResult`.
  Check `exit_code`. `output` holds standard output and standard error
  together.
- Calls happen in the order of the chain, and each one happens at once. If
  `main` fails later, what earlier calls changed stays changed, even
  when the report says "The changes of this run were dropped".

## Rules that models get wrong

- No side effects. You cannot "call" `write_file` and go on: each task must
  be part of the chain that `main` returns. A task that is built but not
  chained with `andThen` or put in `batch` does not run.
- `String.toInt`, `List.head`, `Dict.get`, `List.maximum` give a `Maybe`:
  match `Just value` and `Nothing`, not `Ok` and `Err`. Use
  `Maybe.withDefault 0` for a default.
- A `Result` (`Ok`, `Err`) becomes a task with `fromResult`.
- Every task in one chain has the same error type. `Surface` functions fail
  with `Error`; your own `fail "text"` fails with `String`. Convert with
  `mapErr` before you join them, or fail with `Failed "text"` instead.
- `if` always has `else`. `case` branches are indented under `case ... of`.
- Strings: `"..."` with `\n`, `\t`, `\"` and `\\`. `"""..."""` holds text
  with line breaks and `"`. Join text with `++`. Numbers become text with
  `String.fromInt` or `String.fromFloat`.
- Lambdas: `\x -> x + 1`. Field access: `.path` or `entry.name`. Record
  update: `{ r | count = r.count + 1 }`.
- Integers and floats do not mix: `toFloat n`, `round x`. Integer division
  is `//`; `/` is for floats.

## Files

```elm
module Main exposing (main)

import Agent exposing (..)
import Surface exposing (..)


main : Task Error (List String)
main =
    bash { command = "find src -name '*.js' | sort", timeout = 0 }
        |> andThen
            (\found ->
                found.output
                    |> String.lines
                    |> List.filter (\path -> path /= "")
                    |> List.map
                        (\path ->
                            read_file { path = path, offset = 0, limit = 0 }
                                |> andThen
                                    (\text ->
                                        write_file { path = path, content = String.replace "var " "let " text }
                                    )
                                |> map (\_ -> path)
                        )
                    |> batch
            )
```

- `read_file { path = "a.txt", offset = 10, limit = 11 }` reads lines 10
  to 20 (the first line is 1).
- `edit_file { path = "a.js", edits = [ { oldText = "let a = 1;", newText = "let a = 2;" } ] }`
  replaces exact text. Each `oldText` must occur exactly once in the file,
  or the call fails with `Failed` and nothing changes.
- `write_file` replaces the whole file and makes missing folders.
- Listing, moving, copying and removing files go through `bash`: `ls`,
  `find`, `mv`, `cp`, `rm`, `mkdir -p`. Put temporary files in `/tmp`, not
  in `/work`.
- `read_file` and `write_file` are for text. Handle other files with a
  program through `bash`, such as `sha256sum`.

## Commands, HTTP and SQLite

```elm
module Main exposing (main)

import Agent exposing (..)
import Surface exposing (..)


checked : BashResult -> Task Error String
checked result =
    if result.exit_code == 0 then
        succeed result.output

    else
        fail (Failed result.output)


main : Task Error { status : String, names : List String }
main =
    bash { command = "curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/items", timeout = 0 }
        |> andThen checked
        |> andThen
            (\status ->
                bash { command = "sqlite3 -separator '|' app.db 'SELECT id, name FROM users;' | cut -d '|' -f 2", timeout = 0 }
                    |> andThen checked
                    |> map (\out -> { status = status, names = List.filter (\n -> n /= "") (String.lines out) })
            )
```

- There is no JSON decoder. Get plain text from the command instead:
  `sqlite3 -separator '|'` gives one row per line, and `cut`, `awk`, `jq -r`
  or `grep` in the command keep only the fields you need. Split the rest
  with `String.lines` and `String.split "|"`.
- `curl` exits 0 for any HTTP status. Print the status with
  `-w '%{http_code}'`, as above, or add `-f` to make a status of 400 or more
  an exit code. Only services on `127.0.0.1` or `localhost` answer.
- Pass longer SQL or a JSON body on standard input with a heredoc, written
  in a `"""` string: `sqlite3 app.db <<'SQL'`, then the SQL, then `SQL` on
  its own line.
- Keep output short with `head`, `grep` or `wc -l` in the command. Output
  over 1 MiB is cut in the middle: then `truncated` is `True` and
  `full_output_path` names a file with all of it.
- Check that a program exists with `command -v name` before you rely on it.

## Errors

```elm
module Main exposing (main)

import Agent exposing (..)
import Surface exposing (..)


main : Task Error String
main =
    read_file { path = "notes.txt", offset = 0, limit = 0 }
        |> onError
            (\problem ->
                case problem of
                    Failed _ ->
                        succeed "(no notes)"

                    Refused message ->
                        fail (Refused message)
            )
```

## Method

1. Look first: one program that lists and reads what you need to plan, and
   returns it.
2. Then one program that makes the change and checks it, for example by
   running the tests with `bash`, and fails if the check fails.
3. Keep the value of `main` short: counts, the lines that matter,
   `String.left 2000 text`.
4. After a compile error, read the report and the `Hint:` line, fix only
   that, and send the whole program again.
