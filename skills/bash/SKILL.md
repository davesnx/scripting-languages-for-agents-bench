---
name: bash
description: Write Bash scripts for the run_script tool. Use when the work must be done with Bash scripts.
---

# Bash

You send a Bash script to the `run_script` tool. The tool saves the script to
a file and runs it with `bash <file>`, in the folder `/work`. The result is
the exit code, then the output: standard output, then standard error.

## How a script runs

- Each call starts a new `bash` process. Variables, functions, `cd` and `set`
  options do not stay between calls. Files that a script writes stay.
- The script runs as root in a Linux container (Debian 12). No human can
  answer a prompt. A command that waits for input waits until the time limit.
  Give such commands their input, or a flag such as `-y`.
- There is no internet. Services that the task names on `127.0.0.1` work.
- Programs: `bash`, coreutils, `find`, `grep`, `sed`, `awk`, `git`,
  `sqlite3`, `python3`, `node`, `npm`, `jq`, `curl`, `tar`, `gzip`.

## Syntax

```bash
name="my file.txt"            # no spaces around =
echo "Hi ${name}"             # double quotes expand variables
echo 'no $expansion here'     # single quotes keep text as is
count=$((count + 2))          # arithmetic
files=(a.txt "b c.txt")       # an array
for f in "${files[@]}"; do echo "$f"; done
out=$(git status --short)     # the output of a command
```

- Put double quotes around every variable and `$( )`: `"$f"`. Without
  quotes, a name with a space becomes two words, and `*` expands.
- `[[ ... ]]` tests: `[[ -f "$f" ]]` (file), `[[ -d "$d" ]]` (folder),
  `[[ -z "$s" ]]` (empty), `[[ "$a" == "$b" ]]`, `[[ "$s" =~ ^v[0-9]+ ]]`.
- Numbers: `(( n > 10 ))`.
- `--` ends the options of most programs: `rm -- "$f"` also works when the
  name starts with `-`.

## Control flow

```bash
if (( count > 10 )); then
  echo many
elif (( count > 0 )); then
  echo some
else
  echo none
fi

while IFS= read -r line; do
  echo "line: $line"
done < input.txt

find ./src -name '*.js' -print0 | while IFS= read -r -d '' f; do
  grep -q TODO "$f" && echo "$f"
done

for i in 1 2 3; do
  curl -sf http://127.0.0.1:8000/ && break
  sleep 2
done
```

## Errors

A failed command does not stop a script unless you ask for it:

```bash
set -euo pipefail     # stop at the first error, on unset variables, and in pipes
```

- `cmd || echo "cmd failed"` handles one failure.
- `$?` is the exit code of the last command.
- `trap 'echo "failed at line $LINENO"' ERR` reports where a script stopped.

## Files

```bash
cat README.md
sed -n '10,20p' src/app.js          # lines 10 to 20
grep -rn 'TODO' src/                # find text, with line numbers
sed -i 's/getTotal(/cartTotal(/g' src/*.js
printf '%s\n' "one more line" >> log.txt
mkdir -p out/2024
mv -n old.txt new.txt               # -n: never replace a file
cp -p a.txt backup/a.txt
rm -- tmp/old-notes.md
sha256sum file.bin                  # compare content
```

To write a file with exact content, use a here document. Quote the marker,
so that `$` and backticks stay as typed:

```bash
cat > src/config.js <<'EOF'
export const retries = 5;
EOF
```

## JSON, HTTP and SQLite

```bash
jq -r '.version' config.json
curl -sf http://127.0.0.1:8080/items | jq '.[].name'
curl -s -o body.txt -w '%{http_code}' -X POST --data-binary @file.csv http://127.0.0.1:8080/upload/file.csv
sqlite3 -header app.db 'SELECT * FROM users LIMIT 5;'
```

`curl -f` gives a non-zero exit code for an HTTP error status. Without `-f`,
curl succeeds on 404 and 503.

## Git

```bash
git status --short --branch
git diff
git switch -c fix-parser
git add src/a.js test/a.test.js
git commit -m 'Fix the parser'
git log --oneline -10
git fetch origin
git rebase origin/main
git push origin fix-parser
```

## Method

1. Look first: list the files, read the parts that you will change, and
   check the state (`git status`, a row count, a file list).
2. Change one thing, then check the result.
3. Keep the output short: `grep` for the lines that matter, `head`, `tail`.
4. After an error, read the message, fix the cause, and run again.
