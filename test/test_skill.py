#!/usr/bin/env python3
"""End-to-end test of the session-queue skill.

Each scenario builds a throwaway git repo (a tiny Python project with a
git-ignored `queues/` queue folder), runs `claude -p` in it with this
checkout's plugin loaded, and checks what the skill left behind:

- hard checks (✓/✗) on files, the queue table, and git state;
- judged checks (marked "judge") on the wording of Claude's reply, graded
  by a small model, for things only the reply can show (it asked, it
  offered at most two parallel sessions, ...);
- warnings (⚠) for tool calls the harness's allowlist refused.

Two fixtures:
- simple: three plain rows (subtract, multiply after 1, an unplaced Rust rewrite);
- rich:   ten rows in every state: DONE with and without a hash, DROPPED,
          PAUSED with a WIP branch, a row with a task folded in, four
          independent rows for parallel offers, and an unplaced row.

Multi-turn scenarios continue the same conversation with --resume, to
cover what happens after the user answers (approve, decide, stop, ...).

Usage:
    python3 test/test_skill.py                  # everything (~$5, a few minutes)
    python3 test/test_skill.py resume skip      # by name
    python3 test/test_skill.py --list           # names and descriptions
    python3 test/test_skill.py --changed [REF]  # only scenarios covering skill
                                                # sections changed since REF (HEAD)
    python3 test/test_skill.py --changed --dry  # just list them, with a cost estimate

Exit code: 0 all passed, 1 a scenario failed, 2 none failed but a usage
limit stopped some (marked LIMIT; the summary prints the rerun command).
    MODEL=opus JOBS=4 BUDGET=3 python3 test/test_skill.py

Sandboxes are kept under test/runs/<timestamp>/<scenario>/, with the
transcript of replies in claude-output.txt. test/runs/ is in .gitignore,
so nothing there gets committed.
"""

import concurrent.futures as cf
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

REPO_DIR = Path(__file__).resolve().parent.parent
RUNS_DIR = Path(__file__).resolve().parent / "runs"
MODEL = os.environ.get("MODEL", "sonnet")  # queue rows are assigned this model
JUDGE_MODEL = os.environ.get("JUDGE_MODEL", "haiku")
BUDGET = os.environ.get("BUDGET", "2.00")  # per turn
TIMEOUT = int(os.environ.get("TIMEOUT", "900"))  # per turn
JOBS = int(os.environ.get("JOBS", "8"))
TODAY = time.strftime("%Y-%m-%d")
OTHER_MODEL = "opus" if MODEL != "opus" else "sonnet"
LIMIT_RE = re.compile(r"hit your .{0,20}limit|usage limit|rate limit", re.I)
STOP = threading.Event()  # set once a usage limit is hit: start nothing new


class Limit(Exception):
    """A usage limit stopped a turn or the judge: the scenario is inconclusive."""

PREAMBLE = ("(Automated test: this is a non-interactive run. You can't receive "
            "answers within this turn, so wherever you'd wait for the user, ask "
            "and stop.)\n\n")

# --------------------------------------------------------------------------
# Git and file helpers
# --------------------------------------------------------------------------

def git(repo, *args, check=True):
    return subprocess.run(["git", "-C", str(repo), *args], check=check,
                          capture_output=True, text=True).stdout.strip()


def commit_all(root, msg):
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", msg)
    return git(root, "rev-parse", "HEAD")


def write(root, rel, text):
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)


def read(root, rel):
    p = root / rel
    return p.read_text() if p.is_file() else ""


def edit(root, rel, old, new):
    text = read(root, rel)
    assert text.count(old) == 1, f"fixture edit: {old!r} not found once in {rel}"
    write(root, rel, text.replace(old, new))


def table(root, qfile="queue-demo.md"):
    """Ordered dict: row id -> [session, topic, status, model]."""
    out = {}
    for line in read(root, f"queues/{qfile}").splitlines():
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) == 5 and cells[0] not in ("#",) and not set(cells[0]) <= set("-"):
            out[cells[0]] = cells[1:]
    return out


def row_lines(root, qfile="queue-demo.md"):
    return [l for l in read(root, f"queues/{qfile}").splitlines()
            if re.match(r"\|\s*[0-9A-Za-z]+\s*\|", l) and not l.startswith("| #")]


def status(root, rid, qfile="queue-demo.md"):
    return table(root, qfile).get(rid, ["", "", "<missing>", ""])[2]


def tree_hash(path: Path):
    h = hashlib.sha256()
    for p in sorted(path.rglob("*")):
        if p.is_file():
            h.update(str(p.relative_to(path)).encode())
            h.update(p.read_bytes())
    return h.hexdigest()


def refs(root):
    """branch name -> commit hash, for every local branch."""
    out = git(root, "for-each-ref", "--format=%(refname:short) %(objectname)", "refs/heads")
    return dict(l.split() for l in out.splitlines() if l)


def unittest_run(root, *names):
    r = subprocess.run([sys.executable, "-m", "unittest", *names], cwd=root,
                       capture_output=True, text=True)
    return r.returncode == 0, r.stderr


def worktrees(root):
    """branch -> path for every linked worktree (not the main checkout)."""
    out, path = {}, None
    for l in git(root, "worktree", "list", "--porcelain").splitlines():
        if l.startswith("worktree "):
            path = Path(l[9:])
        elif l.startswith("branch ") and path and path.resolve() != root.resolve():
            out[l[7:].removeprefix("refs/heads/")] = path
        elif l == "detached" and path and path.resolve() != root.resolve():
            out[f"(detached {path.name})"] = path
    return out


def py_has(root, rel, name):
    return re.search(rf"^def {name}\(", read(root, rel), re.M) is not None


# --------------------------------------------------------------------------
# Fixtures
# --------------------------------------------------------------------------

def topic(title, words, placement, known="", rest=""):
    return f'''# To-do: {title} (added 2026-11-01, the user, while starting the queue)

**The user:** "{words}"

**Placement.** {placement}

## What's known
- `calc.py` holds the arithmetic functions; `test_calc.py` tests them with unittest.
{known}
{rest}## Decisions

## Session notes
'''


def queue_file(title, goal, rows, notes, branching="work on main"):
    return f'''# {title} queue

`next-session` runs from this file.

**Goal.** {goal}

**How the queue runs.** With the `session-queue` skill (workflows, principles, parallel sessions). Only this project's specifics are below. The queue folder is ignored by git: never stage it.

**Memory.** Handoffs go in each topic file's session notes.

**Branching.** {branching} (chosen 2026-11-01; see the skill's Branching section).

**Notify.** off (chosen 2026-11-01; see the skill's Notifications section).

## Checks
Keep at 0 / green after every session:
- `python3 -m unittest -q`
- A low `/code-review` of each session's diff before its commit.

## Worktree setup
For a parallel session in a git worktree:
- Nothing shared: no state, ports, or dependencies.

## Sessions

| # | Session | Topic file | Status | Model |
|---|---|---|---|---|
{rows}

{notes}
'''


def base_repo(root):
    _rewrite_calc(root, ("add",))
    write(root, ".gitignore", "queues/\n__pycache__/\nclaude-output.txt\n")
    root.mkdir(parents=True, exist_ok=True)
    git(root, "init", "-q", "-b", "main")
    git(root, "config", "user.name", "Queue Test")
    git(root, "config", "user.email", "queue-test@example.invalid")
    return commit_all(root, "Initial calc")


def build_simple(root, fx):
    base_repo(root)
    write(root, "queues/queue-demo.md", queue_file(
        "Calc demo", "Grow `calc.py` into a small arithmetic module with tests.",
        f"| 1 | Add `subtract(a, b)` to calc.py, with a test | `demo/subtract.md` | TODO | {MODEL} |\n"
        f"| 2 | Add `multiply(a, b)` to calc.py, with a test | `demo/multiply.md` | TODO (after 1) | {MODEL} |\n"
        f"| 3 | Rewrite calc in Rust | `demo/rust.md` | TODO (placement not decided) | {OTHER_MODEL} |",
        "2 comes after 1 because both edit calc.py."))
    write(root, "queues/demo/subtract.md", topic(
        "subtract", "add a subtract function", "First. Small and self-contained.",
        "- Plain function, same style as `add`. No open questions.\n"))
    write(root, "queues/demo/multiply.md", topic("multiply", "add multiply", "After 1 (same file)."))
    write(root, "queues/demo/rust.md", topic("Rust rewrite", "maybe rewrite this in Rust someday", "Not decided."))


def build_rich(root, fx):
    base_repo(root)
    write(root, "README.md", "# calc\n\nA tiny arithmetic module.\n")
    commit_all(root, "Add README")
    # Session 1 and 2's commits, as earlier sessions made them.
    _rewrite_calc(root, ("add", "subtract"))
    fx["h1"] = commit_all(root, "Add subtract(a, b) with a test")
    _rewrite_calc(root, ("add", "subtract", "multiply"))
    fx["h2"] = commit_all(root, "Add multiply(a, b) with a test")
    # Session 3 paused with a WIP commit on its branch.
    git(root, "checkout", "-q", "-b", "q/3-divide")
    write(root, "calc.py", read(root, "calc.py") + "\n\ndef divide(a, b):\n    return a / b\n")
    fx["h3wip"] = commit_all(root, "WIP: divide (session 3, paused)")
    git(root, "checkout", "-q", "main")

    m = MODEL
    rows = f"""| 1 | Add `subtract(a, b)`, with a test | `demo/subtract.md` | **DONE 2026-11-05** (committed {fx['h1'][:7]}; subtract added) | {m} |
| 2 | Add `multiply(a, b)`, with a test | `demo/multiply.md` | DONE 2026-11-08 (multiply added) | {m} |
| 2b | Add `power(a, b)` | `demo/power.md` | DROPPED 2026-11-09 (the user: not needed) | {m} |
| 3 | Add `divide(a, b)`, raising ValueError on zero, with tests | `demo/divide.md` | PAUSED 2026-11-10 (stopped by the user; WIP commit on q/3-divide) | {m} |
| 4 | Add `mod(a, b)` to calc.py, with a test + Add abs | `demo/mod.md` | TODO (after 3) | {m} |
| 5 | Add `slugify(s)` in a new strings.py, with tests | `demo/slugify.md` | TODO | {m} |
| 6 | Add a usage section to README.md | `demo/readme.md` | TODO | {m} |
| 7 | Add a CLI in a new cli.py (`python3 cli.py add 2 3` prints 5) | `demo/cli.md` | TODO | {m} |
| 7b | Add a CONTRIBUTING.md | `demo/contributing.md` | TODO | {m} |
| 8 | Rewrite calc in Rust | `demo/rust.md` | TODO (placement not decided) | {OTHER_MODEL} |"""
    notes = ("4 comes after 3 because both edit calc.py. 5, 6, 7, and 7b each touch only "
             "their own file and don't depend on each other. 8's placement is for the user to set.")
    write(root, "queues/queue-demo.md", queue_file(
        "Calc demo", "Grow `calc.py` into a small arithmetic module, with a CLI and docs.", rows, notes))
    d = "queues/demo/"
    write(root, d + "subtract.md", topic("subtract", "add subtract", "First.") +
          f"- 2026-11-05: added subtract and its test; committed {fx['h1'][:7]}.\n")
    write(root, d + "multiply.md", topic("multiply", "add multiply", "After 1.") +
          "- 2026-11-08: added multiply and its test. Commit hash to be filled in by the next session.\n")
    write(root, d + "power.md", topic("power", "add power", "Not decided.") +
          "\n(Dropped 2026-11-09: the user said it isn't needed.)\n")
    write(root, d + "divide.md", topic(
        "divide", "add divide; it should raise ValueError when dividing by zero", "After 2.",
        "- Decided: true division (`a / b`), and `ValueError(\"division by zero\")` on b == 0.\n") +
        "- 2026-11-10 (paused, stopped by the user). Done: `divide(a, b)` returning `a / b`, "
        "in a WIP commit on branch `q/3-divide`. Left: raise ValueError on b == 0, and add tests "
        "for both cases. Resume on `q/3-divide`.\n")
    write(root, d + "mod.md", topic(
        "mod", "add mod", "After 3 (same file).", "",
        "## Folded in\n\n### Add abs (folded in 2026-11-09)\n**The user:** \"also add abs(x) "
        "while you're in calc.py\"\n- Plain wrapper, with a test. No open questions.\n\n"))
    write(root, d + "slugify.md", topic(
        "slugify", "add a slugify helper", "Independent: only strings.py and test_strings.py.",
        "- `slugify(s)`: lowercase; runs of spaces and punctuation become one hyphen; strip "
        "hyphens at the ends. Tests in a new test_strings.py. No open questions.\n"))
    write(root, d + "readme.md", topic(
        "README usage", "the README needs a usage section", "Independent: only README.md.",
        "- Show importing calc and calling each function. No open questions.\n"))
    write(root, d + "cli.md", topic(
        "CLI", "I want to call it from the shell", "Independent: only cli.py and test_cli.py.",
        "- `python3 cli.py <op> <a> <b>` prints the result; ops are the functions in calc.py. "
        "No open questions.\n"))
    write(root, d + "contributing.md", topic(
        "CONTRIBUTING", "add contributor notes", "Independent: only CONTRIBUTING.md.",
        "- How to run the tests; the commit message style. No open questions.\n"))
    write(root, d + "rust.md", topic("Rust rewrite", "maybe rewrite this in Rust someday", "Not decided."))


def _rewrite_calc(root, funcs):
    bodies = {"add": "a + b", "subtract": "a - b", "multiply": "a * b"}
    write(root, "calc.py", "\n\n".join(f"def {f}(a, b):\n    return {bodies[f]}\n" for f in funcs))
    tests = "".join(f"    def test_{f}(self):\n        self.assertEqual(calc.{f}(6, 3), {eval(bodies[f], {'a': 6, 'b': 3})})\n\n"
                    for f in funcs)
    write(root, "test_calc.py", f"import unittest\nimport calc\n\n\nclass TestCalc(unittest.TestCase):\n{tests}\nif __name__ == \"__main__\":\n    unittest.main()\n")


FIXTURES = {"simple": build_simple, "rich": build_rich}

# --------------------------------------------------------------------------
# Checker, context, judge
# --------------------------------------------------------------------------

class Checker:
    def __init__(self, name):
        self.name, self.results, self.cost, self.elapsed = name, [], 0.0, 0.0
        self.limited = False

    @property
    def verdict(self):
        return "LIMIT" if self.limited else "PASS" if self.passed else "FAIL"

    def check(self, ok, what):
        self.results.append((bool(ok), what))
        return bool(ok)

    def warn(self, what):
        self.results.append((None, what))

    @property
    def passed(self):
        return all(ok is not False for ok, _ in self.results)


@dataclass
class Ctx:
    root: Path
    fx: dict                      # fixture facts (commit hashes, ...)
    start: dict                   # snapshot before the first turn
    snaps: list = field(default_factory=list)   # snapshot after each turn
    outs: list = field(default_factory=list)    # reply of each turn

    @property
    def out(self):
        return self.outs[-1] if self.outs else ""


def snapshot(root):
    return {"refs": refs(root), "branch": git(root, "branch", "--show-current"),
            "queues": tree_hash(root / "queues") if (root / "queues").exists() else "",
            "rows": row_lines(root) if (root / "queues/queue-demo.md").exists() else [],
            "queues": sorted(p.name for p in (root / "queues").glob("queue-*.md")),
            "all_rows": {p.name: row_lines(root, p.name) for p in (root / "queues").glob("queue-*.md")},
            "files": {f: read(root, f) for f in ("calc.py", "strings.py", "CHANGELOG.md")},
            "calc": read(root, "calc.py"), "worktrees": worktrees(root)}


def judge(c: Checker, reply, question, label):
    """Ask a small model whether the reply meets `question`; record it as a check."""
    prompt = ("You grade one reply from an AI coding assistant in an automated test. "
              "Judge only from the reply text below; don't assume anything it doesn't say.\n\n"
              f"Question: {question}\n\n"
              "Answer on the first line with exactly PASS or FAIL, then one short sentence why.\n\n"
              f"<reply>\n{reply}\n</reply>")
    try:
        r = subprocess.run(["claude", "-p", prompt, "--model", JUDGE_MODEL, "--tools", "",
                            "--no-session-persistence", "--output-format", "json"],
                           capture_output=True, text=True, timeout=180,
                           cwd=tempfile.gettempdir(), stdin=subprocess.DEVNULL)
        data = json.loads(r.stdout)
        verdict = (data.get("result") or "").strip()
        c.cost += data.get("total_cost_usd") or 0
    except Exception as e:  # noqa: BLE001
        verdict = f"FAIL judge error: {e}"
    if LIMIT_RE.search(verdict) and not verdict.upper().startswith(("PASS", "FAIL")):
        raise Limit(verdict)
    ok = verdict.upper().startswith("PASS")
    why = verdict.split("\n", 1)[-1].strip() if "\n" in verdict else verdict
    c.check(ok, f"judge: {label}" + ("" if ok else f"\n       ({why[:200]})"))


# --------------------------------------------------------------------------
# Scenarios
# --------------------------------------------------------------------------

@dataclass
class Scenario:
    name: str
    about: str
    fixture: str
    turns: list
    verify: Callable
    setup: Optional[Callable] = None     # setup(root, fx) after the fixture
    commits: bool = False                # may add commits / move branches
    branches: bool = False               # may create or delete branches
    allow: tuple = ()                    # tools taken off DISALLOWED for this scenario


SCENARIOS = {}


def scenario(name, about, fixture, turns, setup=None, commits=False, branches=False, allow=()):
    def deco(fn):
        SCENARIOS[name] = Scenario(name, about, fixture, turns, fn, setup, commits, branches, tuple(allow))
        return fn
    return deco


def invariants(c, ctx: Ctx, sc: Scenario):
    """Rules every scenario must keep."""
    root, start = ctx.root, ctx.start
    now = refs(root)
    if not sc.commits:
        moved = [k for k, v in start["refs"].items() if k in now and now[k] != v]
        moved += [k for k in now if k not in start["refs"] and now[k] not in start["refs"].values()]
        c.check(not moved, f"no commit was made on any branch (approval is required) {moved or ''}")
    if not sc.branches:
        c.check(set(now) == set(start["refs"]), f"no branch created or deleted (branches: {sorted(now)})")
    logged = git(root, "log", "--all", "--name-only", "--format=")
    c.check(not re.search(r"^queues/", logged, re.M), "the ignored queue folder was never committed")
    staged = git(root, "diff", "--cached", "--name-only")
    c.check(not re.search(r"^queues/", staged, re.M), "the ignored queue folder is not staged")
    ids_before = [l.split("|")[1].strip() for l in start["rows"]]
    ids_now = list(table(root))
    c.check(all(i in ids_now for i in ids_before), "no row was removed or renumbered")


def waited(c, ctx, rel, func, rid="1", qfile="queue-demo.md", stage="scope"):
    """Turn 1 must claim the row and stop after the scope message, building nothing."""
    s1 = ctx.snaps[0]
    built = re.search(rf"^def {func}\(", s1.get("files", {}).get(rel, ""), re.M)
    c.check(not built, f"turn 1 built nothing before the go-ahead ({func} in {rel})")
    line = next((l for l in s1["all_rows"].get(qfile, []) if l.split("|")[1].strip() == rid), "")
    c.check("IN PROGRESS" in line and f"({stage}" in line,
            f"turn 1 claimed row {rid} at the {stage} stage ({line.split('|')[4].strip() if line else '-'})")


GO = "Go. No parallel sessions."

# ---- simple fixture: single turn -------------------------------------------

@scenario("show", "Where's the queue? reads and changes nothing", "simple", ["Where's the queue?"])
def _(c, ctx):
    c.check(snapshot(ctx.root)["queues"] == ctx.start["queues"], "queue folder unchanged")
    c.check(not py_has(ctx.root, "calc.py", "subtract"), "code unchanged")
    judge(c, ctx.out, "Does the reply say session 1 (subtract) is what runs next, and flag "
          "session 3 (Rust) as needing a placement before it can run?", "names next row and unplaced row")


@scenario("add", "Add a task: placed row or a fold, reported without a placement question", "simple",
          ["Add to the queue: a divide(a, b) function that raises ValueError on zero."])
def _(c, ctx):
    root = ctx.root
    rows = table(root)
    new = [k for k in rows if k not in ("1", "2", "3")]
    folded = [k for k in ("1", "2") if "+" in rows[k][0] and "divide" in rows[k][0].lower()]
    if folded and not new:
        # Folding a small calc.py task into a TODO row in the same file is allowed (workflow 2, step 4).
        t = read(root, "queues/" + rows[folded[0]][1].strip("`"))
        fold = t.split("## Folded in", 1)[-1] if "## Folded in" in t else ""
        c.check("divide" in fold and TODAY in fold, f"row {folded[0]}'s topic file has a dated ## Folded in section")
    elif c.check(len(new) == 1, f"exactly one new row, or a fold (got new {new}, folded {folded})"):
        session, tfile, st, _ = rows[new[0]]
        c.check("divide" in session.lower(), "new row is the divide task")
        c.check(st.startswith("TODO") and "placement not decided" not in st and "pending" not in st,
                f"new row is placed (status: {st})")
        t = read(root, "queues/" + tfile.strip("`"))
        c.check(t, f"topic file {tfile} exists")
        c.check("divide" in t.lower() and TODAY in t, "topic file quotes the user, dated today")
        pl = re.search(r"\*\*Placement\.\*\*(.*)", t)
        c.check(pl and "not decided" not in pl.group(1).lower() and len(pl.group(1).strip()) > 10,
                f"topic file records the placement and why ({pl.group(1).strip()[:80] if pl else '-'})")
        c.check(all(l in row_lines(root) for l in ctx.start["rows"]), "existing rows untouched")
    c.check(not py_has(root, "calc.py", "divide"), "nothing built (only queued)")
    judge(c, ctx.out, "Does the reply say where the task was placed (or which session it was folded into) "
          "and why, WITHOUT asking the user to choose or confirm its place in the queue?",
          "places it and reports, no placement question")


@scenario("drop", "Drop a task: DROPPED row, topic file kept", "simple",
          ["Drop the Rust rewrite from the queue. We're not doing it."])
def _(c, ctx):
    st = status(ctx.root, "3")
    c.check(st.startswith("DROPPED") and TODAY in st, f"row 3 is DROPPED with today's date ({st})")
    c.check(read(ctx.root, "queues/demo/rust.md"), "rust topic file kept as a record")
    c.check(ctx.start["rows"][:2] == row_lines(ctx.root)[:2], "rows 1 and 2 untouched")


@scenario("next", "next-session: scope, wait; go: build row 1 and stop for approval", "simple",
          ["next-session", GO])
def _(c, ctx):
    root = ctx.root
    waited(c, ctx, "calc.py", "subtract")
    judge(c, ctx.outs[0], "Does the reply present what the session will do and then ask for the "
          "user's go-ahead before building (rather than saying it has built anything)?",
          "turn 1 asks for the go-ahead")
    st = status(root, "1")
    c.check(st.startswith("IN PROGRESS") and "waiting for approval" in st,
            f"row 1 is IN PROGRESS (waiting for approval) ({st})")
    c.check(status(root, "2") == "TODO (after 1)", "row 2 not started")
    c.check(py_has(root, "calc.py", "subtract"), "subtract built")
    c.check("subtract" in read(root, "test_calc.py"), "subtract has a test")
    c.check(unittest_run(root)[0], "Checks pass")
    notes = read(root, "queues/demo/subtract.md").split("## Session notes", 1)[-1].strip()
    c.check(len(notes) > 40, "session notes written in the topic file")
    judge(c, ctx.out, "Does the reply propose a commit message and ask for approval before committing?",
          "proposes a commit message and waits")
    judge(c, ctx.out, "Does the reply say a code review of the diff was run (not skipped or left "
          "outstanding)?", "ran the queue's code review")


def setup_discussion(root, fx):
    edit(root, "queues/queue-demo.md", "with a test | `demo/subtract.md`",
         "with a test. **Starts with its discussion** | `demo/subtract.md`")
    edit(root, "queues/demo/subtract.md", "- Plain function, same style as `add`. No open questions.\n",
         "\n## Questions for the discussion (recommendations ★)\n"
         "- **Argument order.** ★ `subtract(a, b)` returns a - b. Alternative: b - a. Risk: low.\n"
         "- **Type checks.** ★ None, like `add`. Alternative: raise TypeError on non-numbers. Risk: low.\n")


@scenario("discussion", "A row that starts with its discussion: claim, ask, build nothing",
          "simple", ["next-session"], setup=setup_discussion)
def _(c, ctx):
    st = status(ctx.root, "1")
    c.check(st.startswith("IN PROGRESS") and "discussion" in st, f"row 1 claimed at the discussion stage ({st})")
    c.check(not py_has(ctx.root, "calc.py", "subtract"), "nothing built before the user decides")
    judge(c, ctx.out, "Does the reply present the open questions (argument order, type checks) with a "
          "recommended option for each and a risk line, and end by asking the user to decide "
          "(or to accept the recommendations) instead of saying it has built anything?",
          "presents ★ options with risks and waits")


def setup_claimed(root, fx):
    edit(root, "queues/queue-demo.md", "| `demo/subtract.md` | TODO |",
         "| `demo/subtract.md` | IN PROGRESS 2026-11-10 (building; calc-1) |")


@scenario("claimed", "Row 1 claimed by another session: leave it alone", "simple",
          ["next-session"], setup=setup_claimed)
def _(c, ctx):
    c.check(status(ctx.root, "1") == "IN PROGRESS 2026-11-10 (building; calc-1)", "the claim is left alone")
    c.check(not py_has(ctx.root, "calc.py", "subtract"), "no code written")
    c.check(status(ctx.root, "2") == "TODO (after 1)", "row 2 (after 1) not started")
    judge(c, ctx.out, "Does the reply say session 1 is claimed (in progress) by another session and "
          "not take it over, and say nothing else can run (row 2 waits on 1, row 3 is unplaced)?",
          "explains the claim; asks rather than taking over")


def setup_model(root, fx):
    edit(root, "queues/queue-demo.md", f"| `demo/subtract.md` | TODO | {MODEL} |",
         f"| `demo/subtract.md` | TODO | {OTHER_MODEL} |")


@scenario("model-switch", "Row 1 wants another model: tell the user to /model and wait",
          "simple", ["next-session"], setup=setup_model)
def _(c, ctx):
    c.check(not py_has(ctx.root, "calc.py", "subtract"), "nothing built on the wrong model")
    judge(c, ctx.out, f"Does the reply tell the user that session 1 is assigned {OTHER_MODEL}, suggest "
          "switching with /model, and stop instead of building?", "asks for a /model switch and waits")


def setup_baseline(root, fx):
    write(root, "test_calc.py", read(root, "test_calc.py").replace(
        "\nif __name__", "    def test_known_bug(self):\n"
        "        self.assertEqual(calc.add(\"2\", \"3\"), 5)  # strings concatenate\n\n\nif __name__"))
    commit_all(root, "Add a failing test for a known bug")


@scenario("baseline", "A Check already fails: record it as the baseline, don't fix or blame",
          "simple", ["next-session", GO], setup=setup_baseline)
def _(c, ctx):
    root = ctx.root
    waited(c, ctx, "calc.py", "subtract")
    c.check(py_has(root, "calc.py", "subtract"), "subtract built")
    ok, err = unittest_run(root)
    fails = re.findall(r"^(?:FAIL|ERROR): (\w+)", err, re.M)
    c.check(fails == ["test_known_bug"], f"only the known bug fails (failures: {fails})")
    notes = read(root, "queues/demo/subtract.md").split("## Session notes", 1)[-1]
    c.check(re.search(r"known_bug|baseline|pre-?existing|already fail", notes, re.I),
            "session notes record the failing Check as a baseline")
    judge(c, ctx.out, "Does the reply say test_known_bug was already failing before this session's "
          "changes (a baseline), and leave it unfixed rather than fixing it unasked?",
          "reports the baseline, doesn't fix it")


def setup_two_queues(root, fx):
    write(root, "queues/queue-docs.md", queue_file(
        "Calc docs", "Document the calc project.",
        f"| 1 | Add a CHANGELOG.md with an entry for add() | `docs/changelog.md` | TODO | {MODEL} |",
        "Only one session so far."))
    write(root, "queues/docs/changelog.md", topic(
        "changelog", "start a changelog", "First.",
        "- Keep a Changelog format; one 'Added' entry for add(). No open questions.\n"))


@scenario("two-ask", "Two open queues, bare next-session: ask which", "simple",
          ["next-session"], setup=setup_two_queues)
def _(c, ctx):
    c.check(status(ctx.root, "1") == "TODO" and status(ctx.root, "1", "queue-docs.md") == "TODO",
            "neither queue's row claimed")
    c.check(not py_has(ctx.root, "calc.py", "subtract") and not (ctx.root / "CHANGELOG.md").exists(),
            "nothing built")
    judge(c, ctx.out, "Does the reply ask the user which of two queues (Demo and Docs) to run, "
          "instead of picking one?", "asks which queue")


@scenario("two-named", "next-session docs runs the docs queue only", "simple",
          ["next-session docs", GO], setup=setup_two_queues)
def _(c, ctx):
    root = ctx.root
    c.check(not ctx.snaps[0]["files"]["CHANGELOG.md"], "turn 1 built nothing before the go-ahead")
    c.check(any("(scope" in l for l in ctx.snaps[0]["all_rows"]["queue-docs.md"]),
            "turn 1 claimed Docs row 1 at the scope stage")
    st = status(root, "1", "queue-docs.md")
    c.check(st.startswith("IN PROGRESS") and "waiting for approval" in st, f"Docs row 1 claimed ({st})")
    c.check((root / "CHANGELOG.md").exists(), "CHANGELOG.md written")
    c.check(row_lines(root) == ctx.start["rows"], "Demo queue untouched")
    c.check(not py_has(root, "calc.py", "subtract"), "Demo's session not built")


@scenario("start-existing", "Start a queue while one is open: offer add / roll over / second",
          "simple", ["Start a queue for adding statistics functions (mean, median)."])
def _(c, ctx):
    files = sorted(p.name for p in (ctx.root / "queues").glob("queue-*.md"))
    c.check(files == ["queue-demo.md"], f"no new queue file yet ({files})")
    judge(c, ctx.out, "Does the reply name the existing open queue (Demo) and ask whether to add to "
          "it, close it and roll over, or start a second queue alongside, with a recommendation?",
          "names the open queue and offers the three choices")


# ---- simple fixture: multi-turn --------------------------------------------

@scenario("approve", "next-session, then approval: commit, DONE with hash", "simple",
          ["next-session", GO, "Approved. Commit it."], commits=True)
def _(c, ctx):
    root = ctx.root
    log = git(root, "rev-list", f"{ctx.start['refs']['main']}..main").split()
    if c.check(len(log) == 1, f"exactly one new commit on main (got {len(log)})"):
        files = git(root, "show", "--name-only", "--format=", log[0]).split()
        c.check(set(files) == {"calc.py", "test_calc.py"}, f"commit holds only the code ({files})")
        st = status(root, "1")
        c.check("DONE" in st and TODAY in st and log[0][:7] in st, f"row 1 DONE with date and hash ({st})")
    c.check(not git(root, "status", "--porcelain"), "working tree clean")
    c.check(status(root, "2") == "TODO (after 1)", "row 2 not started")
    judge(c, ctx.out, "Does the reply name the next session (2, multiply) and its model?",
          "names the next session and model")


def setup_branch_mode(root, fx):
    edit(root, "queues/queue-demo.md", "**Branching.** work on main", "**Branching.** branch per session")


@scenario("branch-mode", "branch per session: work on q/1-*, then merge --no-ff and delete",
          "simple", ["next-session", GO, "Approved. Commit and merge it."],
          setup=setup_branch_mode, commits=True, branches=True)
def _(c, ctx):
    root, s2 = ctx.root, ctx.snaps[1]
    waited(c, ctx, "calc.py", "subtract")
    c.check(re.match(r"q/1-", s2["branch"]), f"turn 2 worked on a q/1-* branch ({s2['branch']})")
    c.check(s2["refs"]["main"] == ctx.start["refs"]["main"], "turn 2 left main untouched")
    parents = git(root, "rev-list", "--parents", "-n", "1", "main").split()
    c.check(len(parents) == 3, "main's tip is a --no-ff merge")
    c.check(py_has(root, "calc.py", "subtract") and git(root, "branch", "--show-current") == "main",
            "subtract is on main, and main is checked out")
    c.check(not [b for b in refs(root) if b.startswith("q/")], f"session branch deleted ({sorted(refs(root))})")
    st = status(root, "1")
    c.check("DONE" in st and TODAY in st, f"row 1 DONE ({st})")
    c.check(unittest_run(root)[0], "Checks pass on the merged result")


@scenario("discuss-decide", "Discussion, then decisions: record them, build, wait for approval",
          "simple", ["next-session", "Go with your recommendations."], setup=setup_discussion)
def _(c, ctx):
    root = ctx.root
    c.check("def subtract" not in ctx.snaps[0]["calc"] and "discussion" in ctx.snaps[0]["rows"][0],
            "turn 1 stopped at the discussion")
    dec = read(root, "queues/demo/subtract.md").split("## Decisions", 1)[-1].split("##", 1)[0]
    c.check(TODAY in dec and re.search(r"a ?- ?b|argument", dec, re.I), "decisions recorded with today's date")
    c.check(py_has(root, "calc.py", "subtract") and unittest_run(root)[0], "subtract built, Checks pass")
    st = status(root, "1")
    c.check("waiting for approval" in st, f"row 1 waiting for approval ({st})")


@scenario("pause", "Stop a session: WIP commit on q/1-*, main clean, row PAUSED", "simple",
          ["next-session", GO, "Stop this session here; I'll come back to it later. "
           "Use your recommended option for the partial work."], commits=True, branches=True)
def _(c, ctx):
    root = ctx.root
    st = status(root, "1")
    c.check(st.startswith("PAUSED") and TODAY in st and "q/1-" in st, f"row 1 PAUSED, naming its branch ({st})")
    c.check(refs(root)["main"] == ctx.start["refs"]["main"], "main has no new commit")
    c.check(git(root, "branch", "--show-current") == "main" and not py_has(root, "calc.py", "subtract"),
            "back on main, with main's code clean")
    br = [b for b in refs(root) if b.startswith("q/1-")]
    if c.check(len(br) == 1, f"one q/1-* branch ({br})"):
        c.check("def subtract" in git(root, "show", f"{br[0]}:calc.py"), "the WIP commit holds the partial work")
    notes = read(root, "queues/demo/subtract.md").split("## Session notes", 1)[-1]
    c.check(re.search(r"q/1-", notes) and re.search(r"left|remain|to do|todo", notes, re.I),
            "session notes say what's left and where the work is")


def setup_no_queue(root, fx):
    shutil.rmtree(root / "queues")


@scenario("start-new", "Start a queue from scratch, answers in turn 2: queue file written",
          "simple", ["Start a queue for growing calc.py into a small arithmetic module.",
                     "Goal: grow calc.py into a small arithmetic module with tests. Name: calc. "
                     "Keep the queue folder ignored by git. Branching: work on main. Pace: speed. "
                     "Notifications: off. Checks: `python3 -m unittest -q`, and a low /code-review before each "
                     "commit. Worktree setup: nothing is shared. First session: add subtract(a, b) "
                     "with a test. Anything still unanswered: use your recommendation and write "
                     "the queue file."], setup=setup_no_queue)
def _(c, ctx):
    q = read(ctx.root, "queues/queue-calc.md")
    c.check(not ctx.snaps[0]["queues"], "turn 1 asked before writing a queue file")
    if c.check(q, "queues/queue-calc.md written"):
        c.check(re.search(r"\*\*Branching\.\*\* work on main", q), "Branching: work on main")
        c.check(re.search(r"\*\*Notify\.\*\* off", q), "Notify: off")
        c.check(re.search(r"^\*\*Pace\.\*\* speed\b", q, re.M), "Pace: speed, in the form the status line reads")
        c.check("python3 -m unittest" in q, "Checks hold the test command")
        c.check(re.search(r"ignored by git", q), "records that the folder is ignored")
        c.check("| # | Session | Topic file | Status | Model |" in q, "has the session table")
        c.check(re.search(r"subtract", q), "first session queued")


# ---- rich fixture ----------------------------------------------------------

PARALLEL_Q = ("Does the reply plainly offer ONE OR TWO sessions to run in parallel (not saying it is "
              "'not offering' any), each with a risk line, "
              "chosen only from sessions {ok}, and NOT offer session(s) {bad} for parallel running? "
              "(Mentioning a session only to say it isn't eligible is fine.)")
NO_PARALLEL_Q = ("Does the reply AVOID offering, suggesting, or asking about running any session in "
                 "parallel (a worktree, a background session, or side by side)? (Not mentioning parallel "
                 "sessions at all counts as yes.)")


@scenario("rich-show", "Show a busy queue: paused reason, next row, open rows only", "rich",
          ["Where's the queue?"])
def _(c, ctx):
    c.check(snapshot(ctx.root)["queues"] == ctx.start["queues"], "queue folder unchanged")
    judge(c, ctx.out, "Does the reply say next-session would resume session 3 (divide), which is "
          "PAUSED because the user stopped it with a WIP commit on q/3-divide?", "next is paused row 3, with its reason")
    judge(c, ctx.out, "Does the reply list the open sessions 3, 4, 5, 6, 7, 7b, and 8 and NOT present "
          "1, 2, or 2b (done or dropped) as open work?", "shows only open rows")


@scenario("resume", "next-session resumes the PAUSED row on its branch; fills the missing hash",
          "rich", ["next-session", "No parallel sessions. Go."])
def _(c, ctx):
    root, fx = ctx.root, ctx.fx
    c.check("ValueError" not in ctx.snaps[0]["calc"], "turn 1 built nothing before the go-ahead")
    c.check(any(l.split("|")[1].strip() == "3" and "(scope" in l for l in ctx.snaps[0]["rows"]),
            "turn 1 claimed row 3 at the scope stage")
    st = status(root, "3")
    c.check(st.startswith("IN PROGRESS") and "waiting for approval" in st, f"row 3 resumed, waiting ({st})")
    c.check(fx["h2"][:7] in status(root, "2"), f"row 2's missing hash filled in ({status(root, '2')})")
    c.check(git(root, "branch", "--show-current") == "q/3-divide", "working on q/3-divide")
    c.check("ValueError" in read(root, "calc.py") and "divide" in read(root, "test_calc.py"),
            "divide finished: ValueError on zero, with tests")
    c.check(unittest_run(root)[0], "Checks pass")
    c.check(all(status(root, r) == ctx_status(ctx, r) for r in ("4", "5", "6", "7", "7b")),
            "no other row claimed")
    judge(c, ctx.outs[0], PARALLEL_Q.format(ok="5, 6, 7, 7b", bad="4 and 8"),
          "≤ 2 parallel offers, eligible rows only")


def ctx_status(ctx, rid):
    for l in ctx.start["rows"]:
        cells = [x.strip() for x in l.strip().strip("|").split("|")]
        if cells[0] == rid:
            return cells[3]
    return None


def setup_blocker(root, fx):
    edit(root, "queues/queue-demo.md", "PAUSED 2026-11-10 (stopped by the user;",
         "PAUSED 2026-11-10 (blocker: waiting on the user to pick float or integer division;")


@scenario("blocker", "A row paused on a blocker: ask whether it's cleared, build nothing",
          "rich", ["next-session"], setup=setup_blocker)
def _(c, ctx):
    root = ctx.root
    on_branch = git(root, "show", "q/3-divide:calc.py")
    c.check("ValueError" not in read(root, "calc.py") and "ValueError" not in on_branch,
            "divide not finished")
    c.check("building" not in status(root, "3"), f"row 3 not moved to building ({status(root, '3')})")
    judge(c, ctx.out, "Does the reply ask the user whether the blocker (float vs integer division) "
          "is cleared before resuming session 3?", "asks whether the blocker is cleared")


def setup_skip(root, fx):
    edit(root, "queues/queue-demo.md",
         "PAUSED 2026-11-10 (stopped by the user; WIP commit on q/3-divide)",
         "IN PROGRESS 2026-11-12 (building; calc-3)")


@scenario("skip", "Skip a claimed row and a row ordered after it; run row 5", "rich",
          ["next-session", GO], setup=setup_skip)
def _(c, ctx):
    root = ctx.root
    waited(c, ctx, "strings.py", "slugify", rid="5")
    st = status(root, "5")
    c.check(st.startswith("IN PROGRESS") and "waiting for approval" in st, f"row 5 run ({st})")
    c.check(status(root, "3") == "IN PROGRESS 2026-11-12 (building; calc-3)", "row 3's claim untouched")
    c.check(status(root, "4") == "TODO (after 3)", "row 4 (after 3) not run")
    c.check(py_has(root, "strings.py", "slugify"), "slugify built in strings.py")
    c.check(unittest_run(root)[0], "Checks pass")
    c.check(not git(root, "status", "--porcelain", "calc.py") and
            refs(root)["main"] == ctx.start["refs"]["main"], "calc.py untouched")
    judge(c, ctx.outs[0], PARALLEL_Q.format(ok="6, 7, 7b", bad="3, 4, and 8"),
          "≤ 2 parallel offers, eligible rows only")


# ---- rich fixture: a second next-session beside one in the main checkout ----
# Another conversation's session holds the main checkout (an IN PROGRESS row with
# no worktree), so next-session must run its row as a parallel session: a git
# worktree at .claude/worktrees/<id>-<slug>, entered with EnterWorktree's path.

PARALLEL_YES = "Yes, run it as a parallel session in its own worktree. Go. No other parallel sessions."
WT_DIR = ".claude/worktrees/"


def setup_busy5(root, fx):
    edit(root, "queues/queue-demo.md", "| `demo/slugify.md` | TODO |",
         "| `demo/slugify.md` | IN PROGRESS 2026-11-12 (building; calc-5) |")


def setup_busy5_wt3(root, fx):
    setup_busy5(root, fx)
    git(root, "worktree", "add", "-q", WT_DIR + "3-divide", "q/3-divide")
    edit(root, "queues/queue-demo.md", "WIP commit on q/3-divide)",
         "WIP commit on q/3-divide, in worktree .claude/worktrees/3-divide)")
    edit(root, "queues/demo/divide.md", "Resume on `q/3-divide`.",
         "Resume on `q/3-divide`, in its worktree `.claude/worktrees/3-divide`.")


def parallel_divide(c, ctx):
    """Row 3 resumed on its existing branch, in a worktree; the main checkout untouched."""
    root, fx = ctx.root, ctx.fx
    s1 = ctx.snaps[0]
    c.check(s1["worktrees"] == ctx.start["worktrees"], f"turn 1 made no worktree ({sorted(s1['worktrees'])})")
    c.check("ValueError" not in s1["calc"], "turn 1 built nothing before the yes")
    wts = worktrees(root)
    wt = wts.get("q/3-divide")
    c.check(wt is not None, f"q/3-divide is checked out in a worktree ({sorted(wts)})")
    c.check(len(wts) == 1, f"only that one worktree, no generated one ({sorted(wts)})")
    if wt is not None:
        c.check(wt.resolve() == (root / WT_DIR / "3-divide").resolve(),
                f"worktree at {WT_DIR}3-divide ({wt})")
        on_wip = subprocess.run(["git", "-C", str(wt), "merge-base", "--is-ancestor", fx["h3wip"], "HEAD"],
                                capture_output=True).returncode == 0
        c.check(on_wip, "worktree builds on the WIP commit")
        c.check("ValueError" in read(wt, "calc.py") and "divide" in read(wt, "test_calc.py"),
                "divide finished in the worktree: ValueError on zero, with tests")
        c.check(unittest_run(wt)[0], "Checks pass in the worktree")
        c.check(not (wt / "queues").exists(), "no queue copy made in the worktree (edited in the main checkout)")
    c.check(git(root, "branch", "--show-current") == "main", "main checkout still on main")
    c.check(read(root, "calc.py") == ctx.start["calc"] and not git(root, "status", "--porcelain", "calc.py", "test_calc.py"),
            "main checkout's calc.py and tests untouched")
    st = status(root, "3")
    c.check(st.startswith("IN PROGRESS") and "waiting for approval" in st,
            f"row 3 in the main checkout's queue: waiting for approval ({st})")
    c.check(status(root, "5") == "IN PROGRESS 2026-11-12 (building; calc-5)", "row 5's claim untouched")
    judge(c, ctx.outs[0], "Does the reply say session 5 is already running (in another conversation, "
          "in the main checkout), and ask whether to run session 3 (divide) as a parallel session "
          "in its own worktree rather than beside it in the main checkout?",
          "names the running session; asks before going parallel")


@scenario("parallel-resume", "Main checkout busy: resume PAUSED row 3 in a new worktree on q/3-divide",
          "rich", ["next-session", PARALLEL_YES], setup=setup_busy5, allow=["EnterWorktree"])
def _(c, ctx):
    parallel_divide(c, ctx)


@scenario("parallel-reuse", "Main checkout busy: resume PAUSED row 3 in its existing worktree",
          "rich", ["next-session", PARALLEL_YES], setup=setup_busy5_wt3, allow=["EnterWorktree"])
def _(c, ctx):
    parallel_divide(c, ctx)
    judge(c, ctx.outs[0], "Does the reply treat session 3 as PAUSED work to resume (in its existing "
          "worktree), not as a session already running elsewhere that it must leave alone?",
          "a PAUSED row's worktree isn't a running session")


@scenario("parallel-new", "Main checkout busy: run TODO row 5 in a new worktree on q/5-*, off main",
          "rich", ["next-session", PARALLEL_YES], setup=setup_skip, branches=True,
          allow=["EnterWorktree"])
def _(c, ctx):
    root = ctx.root
    s1 = ctx.snaps[0]
    c.check(s1["worktrees"] == ctx.start["worktrees"], f"turn 1 made no worktree ({sorted(s1['worktrees'])})")
    c.check(not s1["files"]["strings.py"], "turn 1 built nothing before the yes")
    new = sorted(set(refs(root)) - set(ctx.start["refs"]))
    c.check(len(new) == 1 and new[0].startswith("q/5-"), f"one new branch, q/5-<slug> ({new})")
    c.check(set(ctx.start["refs"]) <= set(refs(root)), "no branch deleted")
    wts = worktrees(root)
    c.check(len(wts) == 1, f"only one worktree, no generated one ({sorted(wts)})")
    wt = wts.get(new[0]) if len(new) == 1 else None
    c.check(wt is not None, f"the new branch is checked out in the worktree ({sorted(wts)})")
    if wt is not None:
        c.check(wt.resolve() == (root / WT_DIR / new[0][2:]).resolve(),
                f"worktree at {WT_DIR}<id>-<slug> ({wt})")
        c.check(git(wt, "merge-base", "HEAD", "main") == ctx.start["refs"]["main"],
                "branched off local main")
        c.check(py_has(wt, "strings.py", "slugify"), "slugify built in the worktree")
        c.check(unittest_run(wt)[0], "Checks pass in the worktree")
    c.check(not (root / "strings.py").exists(), "main checkout has no strings.py")
    c.check(git(root, "branch", "--show-current") == "main", "main checkout still on main")
    st = status(root, "5")
    c.check(st.startswith("IN PROGRESS") and "waiting for approval" in st,
            f"row 5 in the main checkout's queue: waiting for approval ({st})")
    c.check(status(root, "3") == "IN PROGRESS 2026-11-12 (building; calc-3)", "row 3's claim untouched")
    judge(c, ctx.outs[0], "Does the reply say session 3 is already running (in another conversation, "
          "in the main checkout), and ask whether to run session 5 (slugify) as a parallel session "
          "in its own worktree rather than beside it in the main checkout?",
          "names the running session; asks before going parallel")


def setup_all_done(root, fx):
    q = read(root, "queues/queue-demo.md")
    q = q.replace("DONE 2026-11-08 (multiply added)", f"DONE 2026-11-08 (committed {fx['h2'][:7]}; multiply added)")
    for rid in ("3", "4", "5", "6", "7", "7b"):
        q = re.sub(rf"(\| {rid} \|[^|]*\|[^|]*\| )[^|]*(\|)",
                   rf"\1**DONE 2026-11-12** (committed abc{rid:0<4}; done) \2", q)
    write(root, "queues/queue-demo.md", q)


@scenario("only-unplaced", "Only an unplaced row is left: ask to place it", "rich",
          ["next-session"], setup=setup_all_done)
def _(c, ctx):
    c.check(status(ctx.root, "8") == "TODO (placement not decided)", "row 8 not claimed")
    c.check(snapshot(ctx.root)["queues"] == ctx.start["queues"], "queue folder unchanged")
    judge(c, ctx.out, "Does the reply say only session 8 (Rust rewrite) is left and ask the user to "
          "place it before it can run?", "asks the user to place row 8")


FOLD = ("Fold this into session 5 instead of giving it its own row: also add a "
        "`truncate(s, n)` helper that cuts a string to n characters.")


@scenario("fold-todo", "Fold a task into a TODO row: '+ title' and a Folded in section",
          "rich", [FOLD])
def _(c, ctx):
    root = ctx.root
    c.check(list(table(root)) == [l.split("|")[1].strip() for l in ctx.start["rows"]], "no new row")
    sess = table(root)["5"][0]
    c.check("+" in sess and "truncate" in sess.lower(), f"row 5's Session cell shows the folded task ({sess})")
    t = read(root, "queues/demo/slugify.md")
    fold = t.split("## Folded in", 1)[-1] if "## Folded in" in t else ""
    c.check("truncate" in fold and TODAY in fold, "slugify.md has a dated ## Folded in section")
    c.check(len(list((root / "queues/demo").glob("*.md"))) == 10, "no topic file of its own")
    c.check(status(root, "5") == "TODO", "row 5 stays TODO")


def setup_running5(root, fx):
    edit(root, "queues/queue-demo.md", "| `demo/slugify.md` | TODO |",
         "| `demo/slugify.md` | IN PROGRESS 2026-11-12 (building; strings-5) |")


@scenario("fold-running", "Fold into an IN PROGRESS row: placeholder row, message or messenger",
          "rich", [FOLD], setup=setup_running5)
def _(c, ctx):
    root = ctx.root
    c.check(status(root, "5") == "IN PROGRESS 2026-11-12 (building; strings-5)", "row 5's claim untouched")
    row5 = [l for l in ctx.start["rows"] if l.split("|")[1].strip() == "5"][0]
    c.check(row5 in row_lines(root), "row 5's line untouched (its session owns it)")
    new = {k: v for k, v in table(root).items() if k not in [l.split("|")[1].strip() for l in ctx.start["rows"]]}
    if new:
        (rid, (sess, tfile, st, _)), = new.items()
        c.check(st == "TODO (folded into 5, pending)", f"placeholder row status ({st})")
        c.check("slugify.md" in tfile, f"placeholder row points at row 5's topic file ({tfile})")
        c.check("truncate" in read(root, "queues/demo/slugify.md"), "Folded in section written")
    c.check(not py_has(root, "strings.py", "truncate"), "nothing built")
    if not new:
        c.check(snapshot(root)["queues"] == ctx.start["queues"],
                "with no placeholder row, nothing was written (it waits for the user to confirm)")
    judge(c, ctx.out, "Session 5 is running in another conversation that this one can't message. "
          "Does the reply ask the user to confirm they'll pass the change on to that conversation "
          "(or say it messaged that session), and mention that session 5 may already be past building?",
          "handles the running session correctly")


@scenario("add-running", "Add a task related to a running session: never suggest folding into it",
          "rich", ["Add to the queue: a `truncate(s, n)` helper in strings.py that cuts a string "
                   "to n characters."], setup=setup_running5)
def _(c, ctx):
    root = ctx.root
    row5 = [l for l in ctx.start["rows"] if l.split("|")[1].strip() == "5"][0]
    c.check(row5 in row_lines(root), "row 5's line untouched")
    c.check("truncate" not in read(root, "queues/demo/slugify.md"), "nothing folded into session 5")
    new = [k for k in table(root) if k not in [l.split("|")[1].strip() for l in ctx.start["rows"]]]
    if c.check(len(new) == 1, f"one new row of its own ({new})"):
        c.check("folded" not in table(root)[new[0]][2], "the new row isn't a folded placeholder")
    judge(c, ctx.out, "Session 5 (slugify, in strings.py) is running in another conversation. Does the "
          "reply AVOID suggesting or offering to fold the new truncate task into session 5? (Saying it "
          "could run after session 5, or noting that both touch strings.py, is fine.)",
          "doesn't suggest folding into the running session")
    judge(c, ctx.out, NO_PARALLEL_Q, "no parallel offer when adding a task")


@scenario("add-list", "Add a list: each task placed on its own, related ones share a session", "rich",
          ["Add these to the queue: a `truncate(s, n)` helper in strings.py that cuts a string to n "
           "characters; a CHANGELOG.md; an `is_even(n)` function in a new numbers.py; and an "
           "`is_odd(n)` function next to it in numbers.py."])
def _(c, ctx):
    root = ctx.root
    rows = table(root)
    ids0 = [l.split("|")[1].strip() for l in ctx.start["rows"]]
    new = [k for k in rows if k not in ids0]

    def where(word):
        """Rows naming the task in their Session cell, or else in their topic file (a cell may
        say "parity helpers")."""
        hits = [k for k, r in rows.items() if word in r[0].lower()]
        return hits or [k for k, r in rows.items() if k not in ids0 or k == "5"
                        if word in read(root, "queues/" + r[1].strip("`")).lower()]

    trunc, log, even, odd = where("truncate"), where("changelog"), where("is_even"), where("is_odd")
    c.check(all(len(w) == 1 for w in (trunc, log, even, odd)),
            f"each task shows in exactly one row (truncate {trunc}, changelog {log}, is_even {even}, is_odd {odd})")
    c.check(len({*trunc, *log, *even}) == 3, "truncate, CHANGELOG, and the numbers.py pair are in three different rows")
    c.check(even == odd, f"is_even and is_odd share a session ({even}, {odd})")
    if trunc == ["5"]:
        t = read(root, "queues/demo/slugify.md")
        fold = t.split("## Folded in", 1)[-1] if "## Folded in" in t else ""
        c.check("truncate" in fold and TODAY in fold, "truncate folded into row 5 with a dated ## Folded in section")
        c.check(status(root, "5") == "TODO", "row 5 stays TODO")
    for k in new:
        st = rows[k][2]
        c.check(st.startswith("TODO") and "placement not decided" not in st and "pending" not in st,
                f"new row {k} is placed ({st})")
    built = [f for f in ("numbers.py", "CHANGELOG.md", "strings.py") if (root / f).exists()]
    c.check(not built, f"nothing built, only queued ({built or 'no new files'})")
    judge(c, ctx.out, "The user added four tasks at once. Does the reply say where EACH of the four went "
          "(its own row, or folded into which session), WITHOUT asking the user to choose or confirm placements?",
          "reports each placement, no placement question")
    judge(c, ctx.out, NO_PARALLEL_Q, "no parallel offer when adding tasks")


@scenario("insert", "Insert after row 5 with a new id; never renumber", "rich",
          ["Add to the queue, placed right after session 5: a `title_case(s)` helper in strings.py, with tests."])
def _(c, ctx):
    root = ctx.root
    ids0 = [l.split("|")[1].strip() for l in ctx.start["rows"]]
    ids = list(table(root))
    new = [i for i in ids if i not in ids0]
    if c.check(len(new) == 1, f"one new row ({new})"):
        c.check(new[0].startswith("5") and new[0] != "5", f"new id is inserted after 5 ({new[0]})")
        c.check(ids.index(new[0]) == ids.index("5") + 1, "row sits right after row 5")
        st = table(root)[new[0]][2]
        c.check("after 5" in st, f"status says after 5 ({st})")
    c.check(all(l in row_lines(root) for l in ctx.start["rows"]), "existing rows untouched")


@scenario("reorder", "Reorder by moving the row, never renumbering", "rich",
          ["Reorder the queue: session 7 should run before session 5."])
def _(c, ctx):
    root = ctx.root
    ids0 = [l.split("|")[1].strip() for l in ctx.start["rows"]]
    ids = list(table(root))
    c.check(set(ids) == set(ids0), "same ids")
    c.check(ids.index("7") < ids.index("5"), f"row 7 now sits above row 5 ({ids})")
    c.check(status(root, "5").startswith("TODO"), f"row 5 still TODO ({status(root, '5')})")
    c.check(status(root, "7").startswith("TODO") and "after 5" not in status(root, "7"), "row 7 unconstrained by 5")
    if "after 7" not in status(root, "5"):
        c.warn("row 5's status doesn't say after 7 (fine if row order alone carries it)")


@scenario("drop-folded", "Drop a folded task: '+ title' removed, section marked dropped", "rich",
          ["Drop the abs task that's folded into session 4. We don't need it."])
def _(c, ctx):
    root = ctx.root
    sess, _, st, _ = table(root)["4"]
    c.check("abs" not in sess.lower(), f"row 4's Session cell no longer shows abs ({sess})")
    c.check(st == "TODO (after 3)", f"row 4 itself is not dropped ({st})")
    t = read(root, "queues/demo/mod.md")
    c.check("abs" in t and re.search(r"dropped", t, re.I), "Folded in section kept and marked dropped")


@scenario("drop-running", "Drop an IN PROGRESS row: refuse from outside, message instead",
          "rich", ["Drop session 5 from the queue."], setup=setup_running5)
def _(c, ctx):
    c.check(status(ctx.root, "5") == "IN PROGRESS 2026-11-12 (building; strings-5)", "row 5 not dropped")
    judge(c, ctx.out, "Does the reply decline to drop session 5 directly because it's running in "
          "another conversation, and instead message that session or tell the user to tell it?",
          "won't drop a running row from outside")


@scenario("rollover", "Close and roll over: old queue a record, successor with open rows",
          "rich", ["Close this queue and roll it over to a new one.",
                   "Call the new one calc2. Keep everything else the same."])
def _(c, ctx):
    root = ctx.root
    old = read(root, "queues/queue-demo.md")
    c.check(re.search(r"closed", old, re.I) and re.search(r"record", old, re.I), "old queue marked closed, a record")
    new = read(root, "queues/queue-calc2.md")
    if c.check(new, "queues/queue-calc2.md written"):
        c.check(re.search(r"[Ss]uccessor to `?queue-demo", new), "names its predecessor")
        body = new.lower()
        for word in ("divide", "mod", "slugify", "readme", "cli", "contributing", "rust"):
            c.check(word in body, f"carries over the open row: {word}")
        c.check("power" not in body or "dropped" in body, "doesn't carry over the dropped row")
        c.check(re.search(r"\*\*Branching\.\*\* work on main", new) and "python3 -m unittest" in new,
                "carries over branching and Checks")


# --------------------------------------------------------------------------
# Which scenarios cover which part of the skill (for --changed)
# --------------------------------------------------------------------------

# A change in one of these can affect every scenario, so it selects them all.
SHARED = {"frontmatter", "session queue", "files", "principles", "workflows"}

# SKILL.md heading (lowercased, numbering and backticks stripped), or a file
# under skills/session-queue/ -> the scenarios that exercise it.
COVERS = {
    "branching": ["branch-mode", "pause", "resume", "approve", "start-new"],
    "notifications": ["start-new"],
    "pace": ["start-new", "next", "resume", "skip", "add-running"],
    "messages between sessions": ["fold-running", "drop-running", "add-running"],
    "start a queue": ["start-new", "start-existing"],
    "add a task": ["add", "add-list", "drop", "fold-todo", "fold-running", "add-running", "insert",
                   "reorder", "drop-folded", "drop-running"],
    "next-session": ["next", "discussion", "claimed", "model-switch", "baseline", "two-ask",
                     "two-named", "approve", "branch-mode", "discuss-decide", "pause",
                     "resume", "blocker", "skip", "only-unplaced", "parallel-resume",
                     "parallel-reuse", "parallel-new"],
    "parallel sessions in git worktrees": ["next", "resume", "skip", "add-running",
                                           "parallel-resume", "parallel-reuse", "parallel-new"],
    "close or roll over": ["rollover"],
    "show the queue": ["show", "rich-show"],
    "references/branching.md": ["start-new", "branch-mode"],
    "references/start-queue.md": ["start-new", "start-existing"],
    "references/worktree-setup.md": ["start-new"],
    "references/messaging.md": ["fold-running", "drop-running", "add-running"],
    "references/notifications.md": ["start-new"],
    "references/parallel-sessions.md": ["next", "resume", "skip", "add-running",
                                        "parallel-resume", "parallel-reuse", "parallel-new"],
    "templates/queue.md": ["start-new", "rollover"],
    "templates/topic.md": ["start-new", "add", "rollover"],
}
COSTS_FILE = RUNS_DIR / "costs.json"  # last cost of each scenario, for estimates


def changed_sections(ref):
    """Sections of the skill that differ between `ref` and the working tree."""
    skill = REPO_DIR / "skills" / "session-queue"
    diff = subprocess.run(["git", "diff", "-U0", ref, "--", str(skill)], cwd=REPO_DIR,
                          capture_output=True, text=True, check=True).stdout
    diff += "".join(f"+++ b/{f}\n@@ -0,0 +1 @@\n" for f in subprocess.run(
        ["git", "ls-files", "--others", "--exclude-standard", str(skill)], cwd=REPO_DIR,
        capture_output=True, text=True, check=True).stdout.split())
    lines = (skill / "SKILL.md").read_text().splitlines()
    heads = [(i + 1, re.sub(r"^#+\s*(\d+\.\s*)?", "", l).replace("`", "").strip().lower())
             for i, l in enumerate(lines) if l.startswith("#")]
    found, path = set(), ""
    for l in diff.splitlines():
        if l.startswith("+++ "):
            path = l[6:] if l.startswith("+++ b/") else path
        elif l.startswith("@@") and path:
            rel = path.split("skills/session-queue/", 1)[-1]
            if rel != "SKILL.md":
                found.add(rel)
                continue
            start, n = re.match(r"@@ -\S+ \+(\d+)(?:,(\d+))?", l).groups()
            start, n = int(start), int(n if n is not None else 1)
            for ln in range(start, start + max(n, 1)):
                above = [h for at, h in heads if at <= ln]
                found.add(above[-1] if above else "frontmatter")
    return found


def select_changed(ref):
    secs = changed_sections(ref)
    unknown = sorted(s for s in secs if s not in COVERS and s not in SHARED)
    if secs & SHARED or unknown:
        why = sorted(secs & SHARED) + unknown
        print(f"Changed: {', '.join(why)} (shared or unmapped), so every scenario runs.")
        return list(SCENARIOS)
    names = {n for s in secs for n in COVERS[s]}
    print(f"Changed: {', '.join(sorted(secs)) or 'nothing'}.")
    return [n for n in SCENARIOS if n in names]


def estimate(names):
    try:
        costs = json.loads(COSTS_FILE.read_text())
    except (OSError, ValueError):
        costs = {}
    known = [costs[n] for n in names if n in costs]
    if known:
        rest = len(names) - len(known)
        print(f"Estimated ${sum(known):.2f} from last runs" + (f", plus {rest} never run" if rest else ""))


def save_costs(results):
    try:
        costs = json.loads(COSTS_FILE.read_text())
    except (OSError, ValueError):
        costs = {}
    costs.update({c.name: round(c.cost, 2) for c in results if c.verdict != "LIMIT" and c.cost})
    COSTS_FILE.parent.mkdir(exist_ok=True)
    COSTS_FILE.write_text(json.dumps(costs, indent=1, sort_keys=True))


# --------------------------------------------------------------------------
# Runner
# --------------------------------------------------------------------------

ALLOWED = ["Read", "Glob", "Grep", "Skill",
           # path-scoped: plain Edit/Write still prompt for the git-ignored queues/
           "Edit(queues/**)", "Write(queues/**)", "Edit(./**)", "Write(./**)",
           "Bash(python3 *)", "Bash(git *)", "Bash(sed *)", "Agent",
           "Bash(cd *)", "Bash(ls*)", "Bash(cat*)", "Bash(head*)", "Bash(tail*)", "Bash(wc*)",
           "Bash(grep*)", "Bash(find*)", "Bash(date*)", "ListAgents"]
# All of git (but push) is allowed on purpose: a commit made without approval
# must show up as a failed check, not a denied call. Agent is allowed for
# /code-review's subagents; every "Go." declines parallel sessions.
DISALLOWED = ["Bash(git push*)", "AskUserQuestion", "PushNotification",
              "EnterWorktree", "SendMessage"]


def claude_turn(root, prompt, plugin_dir, sid, first, allow=()):
    cmd = ["claude", "-p", (PREAMBLE + prompt) if first else prompt,
           "--plugin-dir", str(plugin_dir),
           "--permission-mode", "acceptEdits",
           "--allowedTools", *ALLOWED, *allow,
           "--disallowedTools", *[t for t in DISALLOWED if t not in allow],
           "--output-format", "json", "--max-budget-usd", BUDGET, "--model", MODEL]
    cmd += ["--session-id", sid] if first else ["--resume", sid]
    try:
        r = subprocess.run(cmd, cwd=root, capture_output=True, text=True,
                           timeout=TIMEOUT, stdin=subprocess.DEVNULL)
        data = json.loads(r.stdout)
        out = data.get("result") or ""
        if LIMIT_RE.search(out) and (data.get("is_error") or len(out) < 300):
            raise Limit(out)
        return out, data.get("permission_denials") or [], data.get("total_cost_usd") or 0
    except subprocess.TimeoutExpired:
        return "[timed out]", [], 0
    except json.JSONDecodeError:
        return f"[bad output]\n{r.stdout}\n[stderr]\n{r.stderr}", [], 0


def run(sc: Scenario, run_dir, plugin_dir):
    root = run_dir / sc.name
    c = Checker(sc.name)
    t0 = time.time()
    if STOP.is_set():
        c.limited = True
        return c
    try:
        fx = {}
        root.mkdir(parents=True)
        FIXTURES[sc.fixture](root, fx)
        if sc.setup:
            sc.setup(root, fx)
        ctx = Ctx(root, fx, snapshot(root))
        sid = str(uuid.uuid4())
        log = []
        for i, prompt in enumerate(sc.turns):
            out, denials, cost = claude_turn(root, prompt, plugin_dir, sid, i == 0, sc.allow)
            c.cost += cost
            ctx.outs.append(out)
            ctx.snaps.append(snapshot(root))
            log.append(f"### Turn {i + 1}: {prompt}\n\n{out}\n" +
                       "".join(f"\n[denied] {json.dumps(d)}" for d in denials))
            c.check(not out.startswith(("[timed out]", "[bad output]")), f"turn {i + 1} finished")
            for d in denials:  # harness gaps, not skill failures; outcome checks catch the effects
                c.warn(f"turn {i + 1} denied {d.get('tool_name')}: {json.dumps(d.get('tool_input'))[:100]}")
        (root / "claude-output.txt").write_text("\n\n".join(log))
        sc.verify(c, ctx)
        invariants(c, ctx, sc)
    except Limit as e:
        c.limited = True
        STOP.set()
        c.warn(f"usage limit: {str(e).strip()[:100]}")
    except Exception as e:  # noqa: BLE001 - a crash is a failure of this scenario
        c.check(False, f"harness error: {type(e).__name__}: {e}")
    c.elapsed = time.time() - t0
    return c


def forget_project(root):
    """Remove the transcripts/memory dir Claude Code keeps for a sandbox path."""
    enc = re.sub(r"[^A-Za-z0-9]", "-", str(root))
    d = Path.home() / ".claude" / "projects" / enc
    if d.is_dir() and enc.endswith("-" + re.sub(r"[^A-Za-z0-9]", "-", root.name)):
        shutil.rmtree(d, ignore_errors=True)


def main():
    args = sys.argv[1:]
    if "--list" in args:
        for sc in SCENARIOS.values():
            print(f"{sc.name:15} {sc.fixture:7} {len(sc.turns)} turn(s)  {sc.about}")
        return
    missing = [n for n in SCENARIOS if not any(n in v for v in COVERS.values())]
    if missing:
        sys.exit(f"scenario(s) not in COVERS: {missing}")
    dry = "--dry" in args
    args = [a for a in args if a != "--dry"]
    if args and args[0] == "--changed":
        names = select_changed(args[1] if len(args) > 1 else "HEAD")
    else:
        names = args or list(SCENARIOS)
    bad = [n for n in names if n not in SCENARIOS]
    if bad:
        sys.exit(f"unknown scenario(s): {bad}; see --list")
    if dry or not names:
        print(f"{len(names)} scenario(s): {' '.join(names) or '(none)'}")
        estimate(names)
        return
    if not shutil.which("claude"):
        sys.exit("claude CLI not found on PATH")

    run_dir = RUNS_DIR / time.strftime("%Y%m%d-%H%M%S")
    # Claude Code won't edit files inside a loaded plugin's folder, and the
    # sandboxes live under this checkout, so load a copy of the working tree
    # (uncommitted skill edits included) from outside it.
    plugin_dir = Path(tempfile.mkdtemp(prefix="session-queue-plugin-"))
    shutil.copytree(REPO_DIR, plugin_dir, dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns(".git", "test"))
    print(f"Running {len(names)} scenario(s) on {MODEL}, {JOBS} at a time, in {run_dir}", flush=True)
    results = []
    try:
        with cf.ThreadPoolExecutor(max_workers=JOBS) as ex:
            futs = {ex.submit(run, SCENARIOS[n], run_dir, plugin_dir): n for n in names}
            for f in cf.as_completed(futs):
                c = f.result()
                results.append(c)
                print(f"  {c.verdict}  {c.name}", flush=True)
    finally:
        shutil.rmtree(plugin_dir, ignore_errors=True)
        for n in names:
            forget_project(run_dir / n)

    save_costs(results)
    results.sort(key=lambda c: names.index(c.name))
    for c in results:
        print(f"\n{c.verdict}  {c.name}  ({c.elapsed:.0f}s, ${c.cost:.2f})  "
              f"{SCENARIOS[c.name].about}")
        for ok, what in c.results:
            if ok is not True or os.environ.get("VERBOSE"):
                print(f"   {'⚠' if ok is None else '✓' if ok else '✗'} {what}")
    failed = [c.name for c in results if c.verdict == "FAIL"]
    limited = [c.name for c in results if c.verdict == "LIMIT"]
    total = sum(c.cost for c in results)
    print(f"\n{len(results) - len(failed) - len(limited)}/{len(results)} passed, "
          f"{len(failed)} failed, {len(limited)} stopped by a usage limit; ${total:.2f}. "
          f"Passing checks hidden; VERBOSE=1 shows them.\nSandboxes: {run_dir}")
    if failed or limited:
        print(f"Rerun: python3 test/test_skill.py {' '.join(failed + limited)}")
    sys.exit(1 if failed else 2 if limited else 0)


if __name__ == "__main__":
    main()
