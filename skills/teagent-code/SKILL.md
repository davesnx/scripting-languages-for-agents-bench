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
this task".

## The program

```elm
module Main exposing (main)

import Agent exposing (..)
import Surface exposing (..)


main : Task Error String
main =
    read_file { path = "README.md" }
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
- A `Surface` function takes one record with every field named (a program
  with no parameters takes `()`: `run_tests ()`), and gives a
  `Task Error a`. A refused call fails with `Refused message`; a failed one
  (a missing file, a target that exists) with `Failed message`.
- A program of the task (such as `sqlite`) does not fail when the program
  fails: it gives an `Outcome`, `{ code, output }`. Check `code`.
- Calls happen in the order of the chain, and each one happens at once. If
  `main` fails later, what earlier calls changed stays changed.

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
    glob { pattern = "src/**/*.js" }
        |> andThen
            (\paths ->
                paths
                    |> List.map
                        (\path ->
                            read_file { path = path }
                                |> andThen
                                    (\text ->
                                        write_file { path = path, content = String.replace "var " "let " text }
                                    )
                                |> map (\_ -> path)
                        )
                    |> batch
            )
```

- `list_dir { path = "." }` gives entries `{ name, kind, size }`; `kind` is
  `"file"`, `"dir"`, `"symlink"` or `"other"`.
- `stat { path = "new.txt" }` gives `Nothing` when nothing is there.
- `rename_path` and `copy_path` never replace a file: they fail with
  `Failed` if the target exists.
- `remove_path` removes one file, symlink, or empty folder. To remove a
  folder, remove what is in it first.
- `read_file` and `write_file` are for text. For other files, use a program
  of the task if it has one (such as a checksum program).

## HTTP and programs of the task

```elm
module Main exposing (main)

import Agent exposing (..)
import Surface exposing (..)


checked : Outcome -> Task Error String
checked result =
    if result.code == 0 then
        succeed result.output

    else
        fail (Failed result.output)


main : Task Error { health : Int, rows : String }
main =
    http { url = "http://127.0.0.1:8080/items", method = "GET", headers = [], body = "" }
        |> andThen
            (\response ->
                sqlite { sql = "SELECT id, name FROM users LIMIT 5;" }
                    |> andThen checked
                    |> map (\rows -> { health = response.status, rows = rows })
            )
```

- `http` gives `{ status, headers, text }` for any status. Check `status`.
  `headers` is a list of `( name, value )`; `body = ""` sends none.
- A list field adds one argument per item: `git_log { argv = [ "main..feature" ] }`.
  Only the programs listed for the task exist.
- There is no JSON decoder. Take what you need from `text` with `String`
  functions, or ask a program of the task for plain text.

## Errors

```elm
module Main exposing (main)

import Agent exposing (..)
import Surface exposing (..)


main : Task Error String
main =
    read_file { path = "notes.txt" }
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
2. Then one program that makes the change and checks it, for example with
   a test program of the task, and fails if the check fails.
3. Keep the value of `main` short: counts, the lines that matter,
   `String.left 2000 text`.
4. After a compile error, read the report and the `Hint:` line, fix only
   that, and send the whole program again.
