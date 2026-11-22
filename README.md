# mend — one patch tool for every AI edit format

[![competition](https://make.fun/badge/hidden-spec-cli-01-run-20261122.svg)](https://make.fun/competitions/hidden-spec-cli-01-run-20261122)
[![rank](https://make.fun/badge/hidden-spec-cli-01-run-20261122/lusiana27/hidden-spec-cli-01-run-20261122/rank.svg)](https://make.fun/competitions/hidden-spec-cli-01-run-20261122)
[![reward](https://make.fun/badge/hidden-spec-cli-01-run-20261122/lusiana27/hidden-spec-cli-01-run-20261122/reward.svg)](https://make.fun/competitions/hidden-spec-cli-01-run-20261122)

mend applies AI-written edits to a tree of text files. Models write edits in four
formats — a unified diff (often with wrong line numbers), SEARCH/REPLACE blocks, the
V4A patch format, and text-editor tool calls as JSON — and mend reads all four to one
written contract, [SPEC.md](SPEC.md), finding the lines an edit names even when the
model drifted their whitespace or indentation, and changing every file or none.

Built for the make.fun bounty
[Build mend, one patch tool for every AI edit format](https://make.fun/competitions/hidden-spec-cli-01-run-20261122).
Try make.fun yourself: https://make.fun/r/j11vkafs

## Usage

```sh
node main.ts [--format=NAME] [--check] [--strict] [PATCH]
```

- `PATCH` is the patch file, relative to the working directory (the root of the tree).
  When it is absent or `-`, the patch is read from standard input.
- `--format=NAME` reads the patch in one format: `unified`, `search-replace`, `v4a`
  or `json`. `auto`, the default, detects the format.
- `--check` does everything but write: the same output and exit code, and no file is
  created, changed or deleted.
- `--strict` matches lines exactly (tier 0 only).
- Options and `PATCH` may come in any order. `--` ends the options.

Example — a unified diff whose line numbers are wrong still applies, because the
hunk takes the occurrence nearest the number it names:

```sh
$ cat fix.patch
--- a/server.js
+++ b/server.js
@@ -40,2 +40,2 @@
   const total = items.length;
-  return total * 2;
+  return total * 3;
$ node main.ts fix.patch
M server.js
ok: 1 file
```

## How it works

Each edit names old lines to replace. mend finds them at the first of three matching
tiers where they occur: tier 0 (every line equal), tier 1 (trailing spaces and tabs
ignored), tier 2 (leading and trailing spaces and tabs ignored). At tier 2 the new
lines are re-indented to the file's own indentation, and context lines are always
written as the file's own matched lines. A unified hunk takes the occurrence nearest
its (possibly wrong) line number; a SEARCH/REPLACE block needs exactly one occurrence;
a V4A chunk follows an anchor and a cursor through the file.

Edits apply in the patch's order to the tree as earlier edits left it. A failed edit
changes nothing, the edits after it still run so every failure is reported, and when
any edit failed no file is written at all.

## Exit codes and output

- Exit 0: the tree is written. One line per changed path (`A`, `D`, `M`, or
  `R <old> -> <new>` for a move), then `ok: <n> files` (or `ok: 1 file`).
- Exit 1: one `error: <code> <path>` line per failed edit
  (`no-match`, `ambiguous`, `missing`, `exists`, `unsafe`), then
  `failed: <k> of <n> edits`. Nothing is written.
- Exit 2: one line, nothing written: `error: usage`, `error: no-patch`,
  `error: format`, or `error: parse <N>`.

## Verification

Node 22 and its standard library only; no install step, no network, deterministic.

```sh
node check.ts /path/to/kit/program/generator/practice.json
```

- Practice checks: **100 of 100 passed** (practice score 1000).
- Own generalization set (`tests/generalization.mjs`, 26 checks written from SPEC.md
  — whitespace drift, indent shifts, wrong diff line numbers, duplicate contexts,
  empty patches, missing files, CRLF, unicode, moves, EOF chunks): **mend 26 of 26,
  strict applier baseline 19 of 26**. The baseline fails exactly the 7 fuzzy-matching
  checks; mend passes them all.

## License

MIT — see [LICENSE](LICENSE).
