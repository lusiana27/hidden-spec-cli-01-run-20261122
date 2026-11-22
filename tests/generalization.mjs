// Generalization set for mend: 26 checks of our own, none of them a practice check.
// Each case carries the outcome SPEC.md requires, worked out from the spec text.
// Run: node tests/generalization.mjs
//   mend     = node main.ts [argv]
//   baseline = node main.ts --strict [argv]  (the house strict applier: tier 0 exact matching only)

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'main.ts');

/** { name, argv, stdin, files, expect: { exit, stdout, changes } } */
const CASES = [
  // ---- unified ----
  { name: 'u1-trailing-ws-tier1', argv: ['-'],
    stdin: '--- a.txt\n+++ b/a.txt\n@@ -1,3 +1,3 @@\n alpha \n-beta\n+beta2\n gamma\n',
    files: { 'a.txt': 'alpha\nbeta\ngamma\n' },
    expect: { exit: 0, stdout: 'M a.txt\nok: 1 file\n', changes: { 'a.txt': 'alpha\nbeta2\ngamma\n' } } },
  { name: 'u2-indent-tier2', argv: ['-'],
    stdin: '--- a.txt\n+++ b/a.txt\n@@ -2,2 +2,2 @@\n   x = 1\n-  y = 2\n+  y = 20\n',
    files: { 'a.txt': 'def f():\n    x = 1\n    y = 2\n' },
    expect: { exit: 0, stdout: 'M a.txt\nok: 1 file\n', changes: { 'a.txt': 'def f():\n    x = 1\n    y = 20\n' } } },
  { name: 'u3-wrong-line-numbers', argv: ['-'],
    stdin: '--- a.txt\n+++ b/a.txt\n@@ -50,2 +50,2 @@\n two\n-three\n+three!\n',
    files: { 'a.txt': 'one\ntwo\nthree\nfour\n' },
    expect: { exit: 0, stdout: 'M a.txt\nok: 1 file\n', changes: { 'a.txt': 'one\ntwo\nthree!\nfour\n' } } },
  { name: 'u4-nearest-duplicate', argv: ['-'],
    stdin: '--- a.txt\n+++ b/a.txt\n@@ -3,2 +3,2 @@\n x = 1\n-y = 2\n+y = 9\n',
    files: { 'a.txt': 'x = 1\ny = 2\nx = 1\ny = 2\n' },
    expect: { exit: 0, stdout: 'M a.txt\nok: 1 file\n', changes: { 'a.txt': 'x = 1\ny = 2\nx = 1\ny = 9\n' } } },
  { name: 'u5-noeol-gains-break', argv: ['-'],
    stdin: '--- a.txt\n+++ b/a.txt\n@@ -2,1 +2,1 @@\n-b\n+c\n',
    files: { 'a.txt': 'a\nb' },
    expect: { exit: 0, stdout: 'M a.txt\nok: 1 file\n', changes: { 'a.txt': 'a\nc\n' } } },
  { name: 'u6-noeol-kept', argv: ['-'],
    stdin: '--- a.txt\n+++ b/a.txt\n@@ -2,1 +2,1 @@\n-b\n+c\n\\ No newline at end of file\n',
    files: { 'a.txt': 'a\nb' },
    expect: { exit: 0, stdout: 'M a.txt\nok: 1 file\n', changes: { 'a.txt': 'a\nc' } } },
  { name: 'u8-create-noeol', argv: ['create.patch'], stdin: null,
    files: { 'create.patch': '--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+hello\n+world\n\\ No newline at end of file\n' },
    expect: { exit: 0, stdout: 'A new.txt\nok: 1 file\n', changes: { 'new.txt': 'hello\nworld' } } },
  { name: 'u10-header-no-plusplus', argv: ['-'],
    stdin: 'diff --git a/a.txt b/a.txt\n--- a.txt\nfoo\n@@ -1,1 +1,1 @@\n-a\n+b\n',
    files: { 'a.txt': 'a\n' },
    expect: { exit: 2, stdout: 'error: parse 3\n', changes: {} } },
  { name: 'u12-multi-hunk-offset', argv: ['-'],
    stdin: '--- a.txt\n+++ b/a.txt\n@@ -1,1 +1,2 @@\n l1\n+NEW\n@@ -3,1 +4,1 @@\n-l3\n+l3x\n',
    files: { 'a.txt': 'l1\nl2\nl3\nl4\nl5\nl6\n' },
    expect: { exit: 0, stdout: 'M a.txt\nok: 1 file\n', changes: { 'a.txt': 'l1\nNEW\nl2\nl3x\nl4\nl5\nl6\n' } } },
  { name: 'u14-missing-file', argv: ['-'],
    stdin: '--- a/ghost.txt\n+++ b/a/ghost.txt\n@@ -1,1 +1,1 @@\n-x\n+y\n',
    files: {},
    expect: { exit: 1, stdout: 'error: missing ghost.txt\nfailed: 1 of 1 edits\n', changes: {} } },
  { name: 'u15-move-to-existing', argv: ['-'],
    stdin: 'diff --git a/a.txt b/b.txt\nrename from a.txt\nrename to b.txt\n--- a/a.txt\n+++ b/b.txt\n@@ -1,1 +1,1 @@\n-a\n+a2\n',
    files: { 'a.txt': 'a\n', 'b.txt': 'b\n' },
    expect: { exit: 1, stdout: 'error: exists b.txt\nfailed: 1 of 1 edits\n', changes: {} } },
  { name: 'u17-old-trailing-ws', argv: ['-'],
    stdin: '--- a.txt\n+++ b/a.txt\n@@ -1,3 +1,3 @@\n a\n-b \n+B\n c\n',
    files: { 'a.txt': 'a\nb\nc\n' },
    expect: { exit: 0, stdout: 'M a.txt\nok: 1 file\n', changes: { 'a.txt': 'a\nB\nc\n' } } },
  // ---- search/replace ----
  { name: 's1-trailing-ws-tier1', argv: ['edit.patch'], stdin: null,
    files: { 'edit.patch': 'a.txt\n<<<<<<< SEARCH\nx = 1 \n=======\nx = 10\n>>>>>>> REPLACE\n', 'a.txt': 'x = 1\ny = 2\n' },
    expect: { exit: 0, stdout: 'M a.txt\nok: 1 file\n', changes: { 'a.txt': 'x = 10\ny = 2\n' } } },
  { name: 's2-ambiguous', argv: ['edit.patch'], stdin: null,
    files: { 'edit.patch': 'a.txt\n<<<<<<< SEARCH\nsame\n=======\nother\n>>>>>>> REPLACE\n', 'a.txt': 'same\nsame\n' },
    expect: { exit: 1, stdout: 'error: ambiguous a.txt\nfailed: 1 of 1 edits\n', changes: {} } },
  { name: 's3-path-from-previous-block', argv: ['edit.patch'], stdin: null,
    files: { 'edit.patch': 'a.txt\n<<<<<<< SEARCH\np\n=======\nP\n>>>>>>> REPLACE\n<<<<<<< SEARCH\nq\n=======\nQ\n>>>>>>> REPLACE\n', 'a.txt': 'p\nq\n' },
    expect: { exit: 0, stdout: 'M a.txt\nok: 1 file\n', changes: { 'a.txt': 'P\nQ\n' } } },
  { name: 's5-crlf', argv: ['edit.patch'], stdin: null,
    files: { 'edit.patch': 'a.txt\n<<<<<<< SEARCH\nb\n=======\nB\n>>>>>>> REPLACE\n', 'a.txt': 'a\r\nb\r\n' },
    expect: { exit: 0, stdout: 'M a.txt\nok: 1 file\n', changes: { 'a.txt': 'a\r\nB\r\n' } } },
  { name: 's7-indent-tier2', argv: ['edit.patch'], stdin: null,
    files: { 'edit.patch': 'a.txt\n<<<<<<< SEARCH\n  indented\n=======\n  indented!\n>>>>>>> REPLACE\n', 'a.txt': '    indented\n    more\n' },
    expect: { exit: 0, stdout: 'M a.txt\nok: 1 file\n', changes: { 'a.txt': '    indented!\n    more\n' } } },
  // ---- v4a ----
  { name: 'v1-anchor-cursor-two-chunks', argv: ['edit.patch'], stdin: null,
    files: { 'edit.patch': '*** Begin Patch\n*** Update File: a.py\n@@ def a():\n     return 1\n+    # note a\n@@ def b():\n     return 2\n+    # note b\n*** End Patch\n', 'a.py': 'def a():\n    return 1\n\ndef b():\n    return 2\n' },
    expect: { exit: 0, stdout: 'M a.py\nok: 1 file\n', changes: { 'a.py': 'def a():\n    return 1\n    # note a\n\ndef b():\n    return 2\n    # note b\n' } } },
  { name: 'v2-move-to', argv: ['edit.patch'], stdin: null,
    files: { 'edit.patch': '*** Begin Patch\n*** Update File: a.txt\n*** Move to: b.txt\n hello\n+world\n*** End Patch\n', 'a.txt': 'hello\n' },
    expect: { exit: 0, stdout: 'R a.txt -> b.txt\nok: 1 file\n', changes: { 'a.txt': null, 'b.txt': 'hello\nworld\n' } } },
  { name: 'v3-add-blank-lines', argv: ['edit.patch'], stdin: null,
    files: { 'edit.patch': '*** Begin Patch\n*** Add File: n.txt\n+one\n\n+three\n\n\n*** End Patch\n' },
    expect: { exit: 0, stdout: 'A n.txt\nok: 1 file\n', changes: { 'n.txt': 'one\n\nthree\n' } } },
  { name: 'v5-update-no-chunk', argv: ['edit.patch'], stdin: null,
    files: { 'edit.patch': '*** Begin Patch\n*** Update File: a.txt\n*** End Patch\n', 'a.txt': 'x\n' },
    expect: { exit: 2, stdout: 'error: parse 2\n', changes: {} } },
  { name: 'v6-eof-empty-insert', argv: ['edit.patch'], stdin: null,
    files: { 'edit.patch': '*** Begin Patch\n*** Update File: a.txt\n@@ \n+z\n*** End of File\n*** End Patch\n', 'a.txt': 'x\ny\n' },
    expect: { exit: 0, stdout: 'M a.txt\nok: 1 file\n', changes: { 'a.txt': 'x\ny\nz\n' } } },
  { name: 'v8-indent-tier2', argv: ['edit.patch'], stdin: null,
    files: { 'edit.patch': '*** Begin Patch\n*** Update File: a.txt\n  deep\n-  code\n+  code!\n*** End Patch\n', 'a.txt': '    deep\n    code\n' },
    expect: { exit: 0, stdout: 'M a.txt\nok: 1 file\n', changes: { 'a.txt': '    deep\n     code!\n' } } },
  { name: 'v9-trailing-ws-tier1', argv: ['edit.patch'], stdin: null,
    files: { 'edit.patch': '*** Begin Patch\n*** Update File: a.txt\n keep \n-change\n+changed\n keep2\n*** End Patch\n', 'a.txt': 'keep\nchange\nkeep2\n' },
    expect: { exit: 0, stdout: 'M a.txt\nok: 1 file\n', changes: { 'a.txt': 'keep\nchanged\nkeep2\n' } } },
  // ---- json ----
  { name: 'j1-str-replace-ambiguous', argv: ['edit.jsonl'], stdin: null,
    files: { 'edit.jsonl': '{"command": "str_replace", "path": "a.txt", "old_str": "dup", "new_str": "X"}\n', 'a.txt': 'dup dup\n' },
    expect: { exit: 1, stdout: 'error: ambiguous a.txt\nfailed: 1 of 1 edits\n', changes: {} } },
  { name: 'j2-insert-middle', argv: ['edit.jsonl'], stdin: null,
    files: { 'edit.jsonl': '{"command": "insert", "path": "a.txt", "insert_line": 1, "new_str": "mid"}\n', 'a.txt': 'l1\nl2\n' },
    expect: { exit: 0, stdout: 'M a.txt\nok: 1 file\n', changes: { 'a.txt': 'l1\nmid\nl2\n' } } },
];

function readTree(dir) {
  const out = {};
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) out[relative(dir, p).split(sep).join('/')] = readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

function runOne(c, extraArgs) {
  const dir = mkdtempSync(join(tmpdir(), 'mend-gen-'));
  try {
    for (const [p, text] of Object.entries(c.files)) {
      const f = join(dir, ...p.split('/'));
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, text);
    }
    const r = spawnSync(process.execPath, [MAIN, ...extraArgs, ...c.argv], { cwd: dir, input: c.stdin ?? '', encoding: 'utf8', timeout: 10000 });
    const exit = r.error !== undefined || r.status === null ? 124 : r.status;
    return { exit, stdout: r.stdout ?? '', files: readTree(dir) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let mendPass = 0;
let basePass = 0;
for (const c of CASES) {
  const want = { ...c.files };
  for (const [p, v] of Object.entries(c.expect.changes)) {
    if (v === null) delete want[p];
    else want[p] = v;
  }
  const check = (got) => {
    const why = [];
    if (got.exit !== c.expect.exit) why.push(`exit ${got.exit}, expected ${c.expect.exit}`);
    if (got.stdout !== c.expect.stdout) why.push(`stdout ${JSON.stringify(got.stdout)}, expected ${JSON.stringify(c.expect.stdout)}`);
    for (const p of new Set([...Object.keys(want), ...Object.keys(got.files)])) {
      if (want[p] === undefined) why.push(`${p} should not exist`);
      else if (got.files[p] === undefined) why.push(`${p} is missing`);
      else if (got.files[p] !== want[p]) why.push(`${p} differs: expected ${JSON.stringify(want[p])}, got ${JSON.stringify(got.files[p])}`);
    }
    return why;
  };
  const mWhy = check(runOne(c, []));
  const bWhy = check(runOne(c, ['--strict']));
  if (mWhy.length === 0) mendPass += 1;
  else process.stdout.write(`MEND FAIL ${c.name}\n  ${mWhy.join('\n  ')}\n`);
  if (bWhy.length === 0) basePass += 1;
  else process.stdout.write(`BASE FAIL ${c.name}: ${bWhy[0]}\n`);
}
process.stdout.write(`mend ${mendPass} of ${CASES.length}, strict baseline ${basePass} of ${CASES.length}\n`);
