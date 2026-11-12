---
name: python
description: Write Python scripts for the run_script tool. Use when the work must be done with Python scripts.
---

# Python

You send a Python 3 script to the `run_script` tool. The tool saves the
script to a file and runs it with `python3 <file>`, in the folder `/work`. The
result is the exit code, then the output: standard output, then standard
error.

## How a script runs

- Each call starts a new Python process. Variables and imports do not stay
  between calls. Files that a script writes stay.
- Python 3.11 with the standard library only. No packages from pip.
- The script runs as root in a Linux container (Debian 12). No human can
  answer `input()`. A program that waits for input waits until the time limit.
- There is no internet. Services that the task names on `127.0.0.1` work.
- Other programs, through `subprocess`: `git`, `sqlite3`, `node`, `npm`,
  `jq`, `curl`, `bash` and coreutils.

## Syntax

```python
total = 0
name = "Ada"
print(f"Hi {name}")
items = [1, 2]
config = {"version": 2}
total += 2
if total > 10 and name != "x":
    print("many")
elif total > 0:
    print("some")
else:
    print("none")
for i, item in enumerate(items):
    print(i, item)
```

An uncaught exception stops the script with exit code 1 and a traceback.

```python
try:
    text = open("missing.txt").read()
except FileNotFoundError as e:
    print("could not read:", e)
```

## Files

```python
from pathlib import Path
import shutil, hashlib

text = Path("README.md").read_text()
lines = text.splitlines()
print("\n".join(lines[9:20]))                     # lines 10 to 20
Path("src/app.js").write_text(text.replace("var ", "let "))
with open("log.txt", "a") as f:
    f.write("one more line\n")
for path in sorted(Path("src").rglob("*.js")):   # also in subfolders
    if "TODO" in path.read_text():
        print(path)
Path("out/2024").mkdir(parents=True, exist_ok=True)
Path("old.txt").rename("new.txt")
Path("tmp/old-notes.md").unlink()
shutil.copy2("a.txt", "backup/a.txt")
hashlib.sha256(Path("photo.jpg").read_bytes()).hexdigest()
```

- `Path.rename`, `os.replace` and `shutil.move` replace a file that is
  already at the new path. Check with `Path(p).exists()` first if that
  matters.
- Use `read_bytes` and `write_bytes` for files that are not text.

## Programs

```python
import subprocess

r = subprocess.run(["git", "status", "--short"], capture_output=True, text=True)
print(r.returncode, r.stdout, r.stderr)
subprocess.run(["npm", "test"], check=True)       # check=True raises on failure
```

Give the arguments as a list. Then no shell reads them, and a name with a
space stays one argument.

## JSON, HTTP and SQLite

```python
import json, sqlite3, time, urllib.request, urllib.error

config = json.loads(Path("config.json").read_text())
Path("config.json").write_text(json.dumps(config, indent=2))

with urllib.request.urlopen("http://127.0.0.1:8080/items", timeout=10) as r:
    items = json.load(r)

request = urllib.request.Request("http://127.0.0.1:8080/upload/a.csv", data=b"x,y\n", method="POST")
for attempt in range(3):
    try:
        with urllib.request.urlopen(request, timeout=10) as r:
            print(r.status)
            break
    except urllib.error.HTTPError as e:                 # 4xx and 5xx status
        print("status", e.code)
        time.sleep(2)

db = sqlite3.connect("app.db")
for row in db.execute("SELECT id, name FROM users LIMIT 5"):
    print(row)
db.execute("UPDATE users SET name = ? WHERE id = ?", ("Ada", 1))
db.commit()
```

`urlopen` raises `HTTPError` for a status of 400 or more.

## Git

Run git as a program:

```python
def git(*args):
    r = subprocess.run(["git", *args], capture_output=True, text=True)
    print(r.stdout + r.stderr)
    return r.returncode

git("switch", "-c", "fix-parser")
git("add", "src/a.js", "test/a.test.js")
git("commit", "-m", "Fix the parser")
git("fetch", "origin")
git("push", "origin", "fix-parser")
```

## Method

1. Look first: list the files, read the parts that you will change, and
   check the state (`git status`, a row count, a file list).
2. Change one thing, then check the result.
3. Keep the output short: print only the lines and fields that you need.
4. After an error, read the traceback, fix the cause, and run again.
