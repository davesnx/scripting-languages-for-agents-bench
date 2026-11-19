---
name: vera-code
description: Write Vera programs for the run_code tool. Vera is a language designed for models to write, compiled to WebAssembly; the program reaches the task only through the functions of the surface, called with its IO and Http effects.
---

# Vera

You send one Vera program to the `run_code` tool. Vera checks its types,
contracts and effects, compiles it to WebAssembly, and runs `main`. The
result is what the program printed with `IO.print`, or the compiler's report,
or the error that stopped it. A program that does not compile changes
nothing. The rules here come from Vera's own reference for models.

## The program

```vera
public fn main(@Unit -> @Unit)
  requires(true)
  ensures(true)
  effects(<IO>)
{
  match IO.read_file("README.md") {
    Ok(@String) -> IO.print(@String.0),
    Err(@String) -> IO.print(string_concat("could not read: ", @String.0))
  };
  ()
}
```

- Every function has this structure, in this order: visibility (`public` or
  `private`), `fn`, the signature, then `requires`, `ensures`, optionally
  `decreases`, then exactly one `effects`, then the body.
- `main` is `public fn main(@Unit -> @Unit)` with the effects it uses:
  `effects(<IO>)`, `effects(<Http>)`, or `effects(<IO, Http>)`.
- Each run starts again. Nothing stays between runs except what the program
  wrote through the surface.

## Slots instead of names

Vera has no variable names. A value is named by its type and an index:
`@Int.0` is the most recent `Int` in scope, `@Int.1` the one before.

```vera
private fn describe(@String, @Int -> @String)
  requires(true)
  ensures(true)
  effects(pure)
{
  let @Int = @Int.0 * 2;
  string_concat(@String.0, string_concat(" ", int_to_string(@Int.0)))
}
```

- Parameters bind left to right: of two `Int` parameters, the second is
  `@Int.0` and the first is `@Int.1`.
- Each type has its own counter. `let @T = ...;` pushes a new `@T.0`; the old
  one becomes `@T.1`.
- A pattern that binds (`Ok(@String)`) pushes a slot the same way: inside
  that arm, the bound value is `@String.0`.
- The index is required: `@Int` alone is not a reference.
- `@T.result` is the return value, only inside `ensures`.

## Rules that models get wrong

- `if` always has `else`, and both branches have braces, each on its own
  lines. `match` must cover every case; `_` matches anything.
- Statements in a block end with `;`. The last expression, without `;`, is
  the block's value. A block whose value is `Unit` ends with `()`.
- There are no loops. Iterate with a recursive function that has a
  `decreases` clause, or with `array_map`, `array_filter`, `array_fold`.
- An anonymous function is `fn(@Int -> @Int) effects(pure) { @Int.0 + 1 }`.
- A function that performs an effect declares it, and so does every function
  that calls it, up to `main`.
- Strings: `string_concat(a, b)`, `string_split(s, sep)`,
  `string_join(parts, sep)`, `string_contains`, `string_starts_with`,
  `string_replace(s, old, new)`, `string_lines`, `string_length`.
  Interpolation: `"n = \(@Int.0)"` for `Int`, `Nat`, `Bool` and `Float64`.
  An interpolation cannot contain a string literal.
- Numbers: `int_to_string`, `parse_int(s)` gives `Result<Int, String>`.
  `Int` and `Nat` mix freely; `Int` and `Float64` do not (`int_to_float`).
- Arrays: `[1, 2]`, `[]` only where the type is known (a typed `let`),
  `array_length`, `array_append`, `array_concat`, `array_map`,
  `array_filter`, `array_fold(arr, init, fn(@Acc, @T -> @Acc) ...)`,
  `@Array<T>.0[@Nat.0]` to index.
- `Option<T>` is `Some(x)` or `None`; `Result<T, E>` is `Ok(x)` or `Err(e)`.
  `option_unwrap_or(o, default)`, `result_unwrap_or(r, default)`.
- Built-in names follow `domain_verb`: `string_*`, `array_*`, `map_*`,
  `json_*`. If the compiler does not know a name, derive it from that rule.

## Reaching the task

```vera
public fn main(@Unit -> @Unit)
  requires(true)
  ensures(true)
  effects(<IO, Http>)
{
  match Http.post("http://surface/glob", "{\"pattern\": \"src/**/*.js\"}") {
    Ok(@String) -> IO.print(string_concat(@String.0, "\n")),
    Err(@String) -> IO.print(string_concat(@String.0, "\n"))
  };
  match IO.write_file("out/report.txt", "done\n") {
    Ok(_) -> IO.print("written\n"),
    Err(@String) -> IO.print(@String.0)
  };
  ()
}
```

- `IO.read_file(path)` gives `Result<String, String>`; `IO.write_file(path,
  text)` gives `Result<Unit, String>`. They are the surface's read_file and
  write_file.
- Every function of the surface, listed above, is
  `Http.post("http://surface/<name>", <arguments as a JSON object>)`. It
  gives `Ok` with the result as JSON text. A refused call gives
  `Err("HTTP 403: refused: ...")`, a failed one `Err("HTTP 400: error: ...")`.
- A program of the task gives `{"code": ..., "output": ...}`. A code other
  than 0 is still `Ok`: check `code`.
- `Http.get(url)` and `Http.post(url, body)` to a service of the task are
  plain requests, and a status that is not 2xx is an `Err`. For another
  method, headers, or the status, call
  `Http.post("http://surface/http", "{\"url\": ..., \"method\": \"PUT\", \"headers\": {...}, \"body\": ...}")`,
  which gives `{"status": ..., "headers": {...}, "text": ...}`.

## JSON

```vera
private fn first_name(@String -> @String)
  requires(true)
  ensures(true)
  effects(pure)
{
  match json_parse(@String.0) {
    Err(@String) -> string_concat("bad JSON: ", @String.0),
    Ok(@Json) -> match json_array_get(@Json.0, 0) {
      None -> "empty",
      Some(@Json) -> option_unwrap_or(json_get_string(@Json.0, "name"), "no name")
    }
  }
}

public fn main(@Unit -> @Unit)
  requires(true)
  ensures(true)
  effects(<IO>)
{
  IO.print(first_name("[{\"name\": \"Ada\"}]"));
  ()
}
```

- `json_parse(text)` gives `Result<Json, String>`; `json_stringify(json)`
  gives text.
- `json_get(j, key)` and `json_array_get(j, i)` give `Option<Json>`;
  `json_array_length(j)`, `json_keys(j)`.
- Typed accessors give `Option`: `json_get_string`, `json_get_int`,
  `json_get_number`, `json_get_bool`, `json_get_array`, and
  `json_as_string`, `json_as_int`, `json_as_array` on a value.
- To build JSON text for a call, join strings, or build a `Json` value
  (`JObject`, `JString`, `JArray`, `JNumber`) and `json_stringify` it.

## Iteration

```vera
private fn print_all(@Array<String>, @Nat -> @Unit)
  requires(@Nat.0 <= array_length(@Array<String>.0))
  ensures(true)
  decreases(array_length(@Array<String>.0) - @Nat.0)
  effects(<IO>)
{
  if @Nat.0 < array_length(@Array<String>.0) then {
    IO.print(string_concat(@Array<String>.0[@Nat.0], "\n"));
    print_all(@Array<String>.0, @Nat.0 + 1)
  } else {
    ()
  }
}

public fn main(@Unit -> @Unit)
  requires(true)
  ensures(true)
  effects(<IO>)
{
  print_all(["a", "b", "c"], 0);
  ()
}
```

The `decreases` measure shrinks on every recursive call and proves the
recursion ends; the `requires` keeps it from going below zero.

## Method

1. Look first: one program that lists and reads what you need to plan, and
   prints it.
2. Then one program that makes the change and checks it.
3. Keep the output short: print only what you need.
4. After a compile error, read the report and its `Fix:` section, fix only
   that, and send the whole program again.
