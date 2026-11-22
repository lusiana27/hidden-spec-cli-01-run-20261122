// main.ts is mend, the CLI SPEC.md specifies, and this is the kit's starting point for it (MIT). It does sections 1 to 4, 9 and 10 of SPEC.md: the command line, the output and
// exit codes, safe paths, format detection, JSON edits and the all-or-nothing write. The other three formats are
// detected and then read as holding no edit, so they answer `error: parse 1`: reading unified diffs (section 6),
// SEARCH/REPLACE blocks (section 7) and V4A patches (section 8), and matching lines at three tiers (section 5), are
// yours to write. Node 22, the standard library alone; run it as `node main.ts [options] [PATCH]`.
//
// In a trial the grader runs `node /bot/main.ts` with MAKEFUN_ENV_URL set, and then this file hands over to runner.ts
// (the last lines below): keep that hand-over and runner.ts as they are, and write the CLI.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

const FORMATS = ['auto', 'unified', 'search-replace', 'v4a', 'json'];

class Exit2 {
  readonly line: string;
  constructor(line: string) {
    this.line = line;
  }
}
class Fail {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path: string) {
    this.code = code;
    this.path = path;
  }
}

const blank = (s: string): boolean => s.trim() === '';

function patchLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

function safe(p: string): boolean {
  return p !== '' && !p.startsWith('/') && !p.includes('\\') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** The tree as the edits leave it: changed paths in `now` (null: deleted), the rest read from disk. */
class Tree {
  private readonly orig = new Map<string, string | null>();
  readonly now = new Map<string, string | null>();
  original(p: string): string | null {
    if (!this.orig.has(p)) {
      let v: string | null = null;
      try {
        if (statSync(p).isFile()) v = readFileSync(p, 'utf8');
      } catch {
        v = null;
      }
      this.orig.set(p, v);
    }
    return this.orig.get(p)!;
  }
  get(p: string): string | null {
    return this.now.has(p) ? this.now.get(p)! : this.original(p);
  }
}

type Edit = (tree: Tree) => void;

function detect(lines: string[]): string | null {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) return null;
  if (lines[first]!.trim() === '*** Begin Patch') return 'v4a';
  const c = lines[first]!.trimStart()[0];
  if (c === '[' || c === '{') return 'json';
  if (lines.some((l) => l.trimEnd() === '<<<<<<< SEARCH')) return 'search-replace';
  if (lines.some((l, i) => l.startsWith('diff --git ') || (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')))) return 'unified';
  return null;
}

/** One JSON edit object (SPEC.md section 9), or null when it is not one. */
function jsonEdit(v: unknown): Edit | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const p = o.path;
  if (typeof p !== 'string') return null;
  const exists = (tree: Tree): string => {
    if (!safe(p)) throw new Fail('unsafe', p);
    const t = tree.get(p);
    if (t === null) throw new Fail('missing', p);
    return t;
  };
  if (o.command === 'create' && typeof o.file_text === 'string') {
    const text = o.file_text;
    return (tree) => {
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) !== null) throw new Fail('exists', p);
      tree.now.set(p, text);
    };
  }
  if (o.command === 'str_replace' && typeof o.old_str === 'string' && o.old_str !== '' && (o.new_str === undefined || typeof o.new_str === 'string')) {
    const oldStr = o.old_str;
    const newStr = (o.new_str as string | undefined) ?? '';
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const crlf = nl > 0 && before[nl - 1] === '\r';
      const lf = (s: string): string => (crlf ? s.replaceAll('\r\n', '\n') : s);
      const t = lf(before);
      const old = lf(oldStr);
      let count = 0;
      for (let k = t.indexOf(old); k >= 0; k = t.indexOf(old, k + 1)) count += 1;
      if (count === 0) throw new Fail('no-match', p);
      if (count > 1) throw new Fail('ambiguous', p);
      const at = t.indexOf(old);
      const out = t.slice(0, at) + lf(newStr) + t.slice(at + old.length);
      tree.now.set(p, crlf ? out.replaceAll('\n', '\r\n') : out);
    };
  }
  if (o.command === 'insert' && typeof o.insert_line === 'number' && Number.isInteger(o.insert_line) && typeof o.new_str === 'string') {
    const line = o.insert_line;
    const add = patchLines(o.new_str);
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const br = nl > 0 && before[nl - 1] === '\r' ? '\r\n' : '\n';
      const lines = before === '' ? [] : before.split(br);
      const final = before !== '' && before.endsWith(br);
      if (final) lines.pop();
      if (line < 0 || line > lines.length) throw new Fail('no-match', p);
      lines.splice(line, 0, ...add);
      tree.now.set(p, lines.length === 0 ? '' : lines.join(br) + (final ? br : ''));
    };
  }
  return null;
}

function jsonEdits(text: string, lines: string[]): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  const edits: Edit[] = [];
  if (lines[first]!.trimStart().startsWith('[')) {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      throw new Exit2(`error: parse ${first + 1}`);
    }
    if (!Array.isArray(v)) throw new Exit2(`error: parse ${first + 1}`);
    for (const x of v) {
      const e = jsonEdit(x);
      if (e === null) throw new Exit2(`error: parse ${first + 1}`);
      edits.push(e);
    }
    return edits;
  }
  lines.forEach((l, i) => {
    if (blank(l)) return;
    let e: Edit | null = null;
    try {
      e = jsonEdit(JSON.parse(l));
    } catch {
      e = null;
    }
    if (e === null) throw new Exit2(`error: parse ${i + 1}`);
    edits.push(e);
  });
  return edits;
}

/** A text file as lines, its line break and whether it ends with one (SPEC.md section 3). */
interface FileDoc {
  lines: string[];
  br: string;
  finalBreak: boolean;
}

function parseFile(text: string): FileDoc {
  if (text === '') return { lines: [], br: '\n', finalBreak: false };
  const nl = text.indexOf('\n');
  const br = nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n';
  const parts = text.split(br);
  const finalBreak = text.endsWith(br);
  if (finalBreak) parts.pop();
  return { lines: parts, br, finalBreak };
}

function writeFileDoc(d: FileDoc): string {
  if (d.lines.length === 0) return '';
  return d.lines.join(d.br) + (d.finalBreak ? d.br : '');
}

const trimEndWs = (s: string): string => s.replace(/[ \t]+$/, '');
const trimWs = (s: string): string => s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
const leadWs = (s: string): string => (/^[ \t]*/.exec(s) ?? [''])[0]!;

function lineEq(a: string, b: string, tier: number): boolean {
  if (tier === 0) return a === b;
  if (tier === 1) return trimEndWs(a) === trimEndWs(b);
  return trimWs(a) === trimWs(b);
}

/** Positions where O occurs in lines at a tier, at or after `from`. */
function occurrences(lines: string[], o: string[], tier: number, from: number): number[] {
  const out: number[] = [];
  if (o.length === 0) return out;
  for (let i = from; i + o.length <= lines.length; i++) {
    let ok = true;
    for (let k = 0; k < o.length; k++) {
      if (!lineEq(lines[i + k]!, o[k]!, tier)) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(i);
  }
  return out;
}

/** The first tier at which O occurs at or after `from`, with its positions (section 5). */
function findTier(lines: string[], o: string[], from: number, strict: boolean): { tier: number; pos: number[] } | null {
  const tiers = strict ? [0] : [0, 1, 2];
  for (const t of tiers) {
    const pos = occurrences(lines, o, t, from);
    if (pos.length > 0) return { tier: t, pos };
  }
  return null;
}

/** One body line of a unified hunk or a V4A chunk: its marker, its text and its raw form. */
interface BodyLine {
  kind: ' ' | '-' | '+' | '\\';
  text: string;
  raw: string;
}

function parseBodyLine(line: string): BodyLine {
  if (line === '') return { kind: ' ', text: '', raw: line };
  const c = line[0]!;
  if (c === ' ' || c === '-' || c === '+') return { kind: c, text: line.slice(1), raw: line };
  return { kind: '\\', text: line.slice(1), raw: line };
}

/** Old lines O and new lines N of a hunk or chunk, each context line of N tied to its line of O. */
interface ON {
  o: string[];
  n: { text: string; ctx: boolean; oIdx: number }[];
}

function splitBody(body: BodyLine[]): ON {
  const o: string[] = [];
  const n: { text: string; ctx: boolean; oIdx: number }[] = [];
  for (const b of body) {
    if (b.kind === ' ') {
      const idx = o.length;
      o.push(b.text);
      n.push({ text: b.text, ctx: true, oIdx: idx });
    } else if (b.kind === '-') o.push(b.text);
    else if (b.kind === '+') n.push({ text: b.text, ctx: false, oIdx: -1 });
  }
  return { o, n };
}

/** Whether a `\` line follows the body's last line of one of the given kinds. */
function backslashAfterLast(body: BodyLine[], kinds: string[]): boolean {
  let last = -1;
  for (let j = 0; j < body.length; j++) if (kinds.includes(body[j]!.kind)) last = j;
  if (last < 0) return false;
  return body[last + 1]?.kind === '\\';
}

/** N with context lines taken from the file's matched lines and tier-2 lines re-indented (section 5). */
function buildNewLines(on: ON, fileLines: string[], at: number, tier: number): string[] {
  const out: string[] = [];
  const f = on.o.length > 0 ? leadWs(fileLines[at]!) : '';
  const p = on.o.length > 0 ? leadWs(on.o[0]!) : '';
  for (const e of on.n) {
    if (e.ctx) {
      out.push(fileLines[at + e.oIdx]!);
      continue;
    }
    let t = e.text;
    if (tier === 2 && t !== '' && !/^[ \t]+$/.test(t) && t.startsWith(p)) t = f + t.slice(p.length);
    out.push(t);
  }
  return out;
}

/** Moves a move edit performed, for the `R` output line (section 2). */
const recordedMoves: { old: string; new: string }[] = [];

interface Hunk {
  a: number;
  body: BodyLine[];
}

interface USection {
  pairOld?: string | null;
  pairNew?: string | null;
  renOld?: string;
  renNew?: string;
  gitOld?: string;
  gitNew?: string;
  isCreate: boolean;
  isDelete: boolean;
  hunks: Hunk[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const GIT_RE = /^diff --git a\/([^ ]+) b\/([^ ]+)\s*$/;

function stripAB(p: string): string | null {
  if (p === '/dev/null') return null;
  if (p.startsWith('a/') || p.startsWith('b/')) return p.slice(2);
  return p;
}

/** A `---`/`+++` path: text after the four characters, up to the first tab, trimmed, prefix removed. */
function pairPath(line: string): string | null {
  const t = line.slice(4).split('\t')[0]!.trim();
  return stripAB(t);
}

function parseHunkHeader(line: string, no: number): Hunk {
  const m = HUNK_RE.exec(line);
  if (!m) throw new Exit2(`error: parse ${no}`);
  return { a: Number(m[1]), body: [] };
}

/** Sections of a unified diff (section 6). */
function parseUnified(lines: string[]): USection[] {
  const sections: USection[] = [];
  let cur: USection | null = null;
  let curHunk: Hunk | null = null;
  let state: 'outside' | 'header' | 'body' | 'after' = 'outside';
  const endBody = (): void => {
    if (curHunk !== null) {
      while (curHunk.body.length > 0 && curHunk.body[curHunk.body.length - 1]!.raw === '') curHunk.body.pop();
      cur!.hunks.push(curHunk);
      curHunk = null;
    }
    state = 'after';
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const next = lines[i + 1];
    if (state === 'body') {
      const endsAtSection = line.startsWith('diff --git ') || (line.startsWith('--- ') && next !== undefined && next.startsWith('+++ '));
      const isBody = line === '' || line.startsWith(' ') || line.startsWith('-') || line.startsWith('+') || line.startsWith('\\');
      if (!endsAtSection && isBody) {
        curHunk!.body.push(parseBodyLine(line));
        continue;
      }
      endBody();
    }
    if (line.startsWith('diff --git ')) {
      const m = GIT_RE.exec(line);
      if (!m) throw new Exit2(`error: parse ${i + 1}`);
      cur = { gitOld: m[1], gitNew: m[2], isCreate: false, isDelete: false, hunks: [] };
      sections.push(cur);
      state = 'header';
      continue;
    }
    if (line.startsWith('--- ') && next !== undefined && next.startsWith('+++ ')) {
      if (state === 'header' && cur !== null && cur.pairOld === undefined && cur.pairNew === undefined) {
        cur.pairOld = pairPath(line);
        cur.pairNew = pairPath(next);
        i++;
        continue;
      }
      cur = { isCreate: false, isDelete: false, hunks: [] };
      sections.push(cur);
      cur.pairOld = pairPath(line);
      cur.pairNew = pairPath(next);
      i++;
      state = 'header';
      continue;
    }
    if (state === 'outside') {
      if (line.startsWith('@@')) throw new Exit2(`error: parse ${i + 1}`);
      continue;
    }
    if (state === 'header') {
      if (line.startsWith('@@')) {
        curHunk = parseHunkHeader(line, i + 1);
        state = 'body';
        continue;
      }
      if (line.startsWith('--- ')) throw new Exit2(`error: parse ${i + 2}`);
      if (line.startsWith('rename from ')) {
        cur!.renOld = line.slice('rename from '.length);
        continue;
      }
      if (line.startsWith('rename to ')) {
        cur!.renNew = line.slice('rename to '.length);
        continue;
      }
      if (line.startsWith('new file mode')) {
        cur!.isCreate = true;
        continue;
      }
      if (line.startsWith('deleted file mode')) {
        cur!.isDelete = true;
        continue;
      }
      continue;
    }
    if (line.startsWith('@@')) {
      curHunk = parseHunkHeader(line, i + 1);
      state = 'body';
      continue;
    }
  }
  if (state === 'body') endBody();
  return sections;
}

/** One edit per unified section (section 6). */
function unifiedEdits(lines: string[], strict: boolean): Edit[] {
  const sections = parseUnified(lines);
  return sections.map((s) => {
    let oldP: string | null;
    let newP: string | null;
    if (s.pairOld !== undefined || s.pairNew !== undefined) {
      oldP = s.pairOld ?? null;
      newP = s.pairNew ?? null;
    } else if (s.renOld !== undefined || s.renNew !== undefined) {
      oldP = s.renOld ?? s.gitOld ?? null;
      newP = s.renNew ?? s.gitNew ?? null;
    } else {
      oldP = s.gitOld ?? null;
      newP = s.gitNew ?? null;
    }
    const isCreate = s.isCreate || oldP === null;
    const isDelete = !isCreate && (s.isDelete || newP === null);
    const isMove = !isCreate && !isDelete && oldP !== newP;
    const applyHunks = (doc: FileDoc, path: string): void => {
      let d = 0;
      for (const h of s.hunks) {
        const on = splitBody(h.body);
        if (on.o.length === 0) {
          const oldLen = doc.lines.length;
          const at = Math.min(h.a + d, oldLen);
          const nl = on.n.map((e) => e.text);
          doc.lines.splice(at, 0, ...nl);
          if (at === oldLen) doc.finalBreak = !backslashAfterLast(h.body, [' ', '+']);
          d += nl.length;
        } else {
          const found = findTier(doc.lines, on.o, 0, strict);
          if (!found) throw new Fail('no-match', path);
          const target = h.a - 1 + d;
          let best = found.pos[0]!;
          let bestDist = Math.abs(best - target);
          for (const p of found.pos) {
            const dist = Math.abs(p - target);
            if (dist < bestDist) {
              best = p;
              bestDist = dist;
            }
          }
          const touchesEnd = best + on.o.length === doc.lines.length;
          const nl = buildNewLines(on, doc.lines, best, found.tier);
          doc.lines.splice(best, on.o.length, ...nl);
          if (touchesEnd) doc.finalBreak = !backslashAfterLast(h.body, [' ', '+']);
          d += on.n.length - on.o.length;
        }
      }
    };
    if (isCreate) {
      return (tree: Tree) => {
        if (newP === null) return;
        if (!safe(newP)) throw new Fail('unsafe', newP);
        if (tree.get(newP) !== null) throw new Fail('exists', newP);
        const plus: string[] = [];
        let lastPlus: { h: Hunk; j: number } | null = null;
        for (const h of s.hunks) {
          for (let j = 0; j < h.body.length; j++) {
            if (h.body[j]!.kind === '+') {
              plus.push(h.body[j]!.text);
              lastPlus = { h, j };
            }
          }
        }
        const noFinal = lastPlus !== null && lastPlus.h.body[lastPlus.j + 1]?.kind === '\\';
        tree.now.set(newP, plus.length === 0 ? '' : plus.join('\n') + (noFinal ? '' : '\n'));
      };
    }
    if (isDelete) {
      return (tree: Tree) => {
        if (oldP === null) return;
        if (!safe(oldP)) throw new Fail('unsafe', oldP);
        if (tree.get(oldP) === null) throw new Fail('missing', oldP);
        tree.now.set(oldP, null);
      };
    }
    if (isMove) {
      const op = oldP!;
      const np = newP!;
      return (tree: Tree) => {
        if (!safe(op)) throw new Fail('unsafe', op);
        if (!safe(np)) throw new Fail('unsafe', np);
        const before = tree.get(op);
        if (before === null) throw new Fail('missing', op);
        if (tree.get(np) !== null) throw new Fail('exists', np);
        const doc = parseFile(before);
        applyHunks(doc, op);
        tree.now.set(np, writeFileDoc(doc));
        tree.now.set(op, null);
        recordedMoves.push({ old: op, new: np });
      };
    }
    const p = oldP!;
    return (tree: Tree) => {
      if (!safe(p)) throw new Fail('unsafe', p);
      const before = tree.get(p);
      if (before === null) throw new Fail('missing', p);
      const doc = parseFile(before);
      applyHunks(doc, p);
      tree.now.set(p, writeFileDoc(doc));
    };
  });
}

/** SEARCH/REPLACE blocks (section 7). */
function srEdits(lines: string[], strict: boolean): Edit[] {
  interface Block {
    path: string;
    old: string[];
    nw: string[];
  }
  const blocks: Block[] = [];
  let prevEnd = -1;
  let prevPath: string | null = null;
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.trimEnd() !== '<<<<<<< SEARCH') {
      i++;
      continue;
    }
    const searchIdx = i;
    let path: string | null = null;
    for (let j = searchIdx - 1; j > prevEnd; j--) {
      const t = lines[j]!.trim();
      if (t === '' || t.startsWith('```')) continue;
      path = t;
      break;
    }
    if (path === null) {
      if (prevPath === null) throw new Exit2(`error: parse ${searchIdx + 1}`);
      path = prevPath;
    }
    let eq = -1;
    for (let j = searchIdx + 1; j < lines.length; j++) {
      if (lines[j]!.trimEnd() === '=======') {
        eq = j;
        break;
      }
    }
    if (eq === -1) throw new Exit2(`error: parse ${searchIdx + 1}`);
    let rep = -1;
    for (let j = eq + 1; j < lines.length; j++) {
      if (lines[j]!.trimEnd() === '>>>>>>> REPLACE') {
        rep = j;
        break;
      }
    }
    if (rep === -1) throw new Exit2(`error: parse ${searchIdx + 1}`);
    blocks.push({ path, old: lines.slice(searchIdx + 1, eq), nw: lines.slice(eq + 1, rep) });
    prevPath = path;
    prevEnd = rep;
    i = rep + 1;
  }
  return blocks.map((b) => (tree: Tree) => {
    if (!safe(b.path)) throw new Fail('unsafe', b.path);
    if (b.old.length === 0) {
      if (tree.get(b.path) !== null) throw new Fail('exists', b.path);
      tree.now.set(b.path, b.nw.length === 0 ? '' : `${b.nw.join('\n')}\n`);
      return;
    }
    const before = tree.get(b.path);
    if (before === null) throw new Fail('missing', b.path);
    const doc = parseFile(before);
    const found = findTier(doc.lines, b.old, 0, strict);
    if (!found) throw new Fail('no-match', b.path);
    if (found.pos.length > 1) throw new Fail('ambiguous', b.path);
    const on: ON = { o: b.old, n: b.nw.map((t) => ({ text: t, ctx: false, oIdx: -1 })) };
    const nl = buildNewLines(on, doc.lines, found.pos[0]!, found.tier);
    doc.lines.splice(found.pos[0]!, b.old.length, ...nl);
    tree.now.set(b.path, writeFileDoc(doc));
  });
}

/** V4A patches (section 8). */
function v4aEdits(lines: string[], strict: boolean): Edit[] {
  const first = lines.findIndex((l) => l.trim() !== '');
  if (first < 0) throw new Exit2('error: parse 1');
  if (lines[first]!.trim() !== '*** Begin Patch') throw new Exit2(`error: parse ${first + 1}`);
  let last = lines.length - 1;
  while (last >= 0 && lines[last]!.trim() === '') last--;
  if (last < 0 || lines[last]!.trim() !== '*** End Patch') throw new Exit2(`error: parse ${lines.length + 1}`);
  interface VSection {
    kind: 'add' | 'delete' | 'update';
    path: string;
    lineNo: number;
    raw: { text: string; no: number }[];
  }
  const sections: VSection[] = [];
  let cur: VSection | null = null;
  for (let i = first + 1; i < last; i++) {
    const line = lines[i]!;
    if (line.startsWith('*** Add File: ') || line.startsWith('*** Delete File: ') || line.startsWith('*** Update File: ')) {
      const kind = line.startsWith('*** Add File: ') ? 'add' : line.startsWith('*** Delete File: ') ? 'delete' : 'update';
      const prefix = kind === 'add' ? '*** Add File: ' : kind === 'delete' ? '*** Delete File: ' : '*** Update File: ';
      cur = { kind, path: line.slice(prefix.length).trim(), lineNo: i + 1, raw: [] };
      sections.push(cur);
      continue;
    }
    if (cur === null) {
      if (line.trim() === '') continue;
      throw new Exit2(`error: parse ${i + 1}`);
    }
    cur.raw.push({ text: line, no: i + 1 });
  }
  for (const s of sections) {
    while (s.raw.length > 0 && s.raw[s.raw.length - 1]!.text.trim() === '') s.raw.pop();
  }
  if (sections.length === 0) return [];
  return sections.map((s) => {
    if (s.kind === 'add') {
      const fileLines: string[] = [];
      for (const r of s.raw) {
        if (r.text.startsWith('+')) fileLines.push(r.text.slice(1));
        else if (r.text === '') fileLines.push('');
        else throw new Exit2(`error: parse ${r.no}`);
      }
      return (tree: Tree) => {
        if (!safe(s.path)) throw new Fail('unsafe', s.path);
        if (tree.get(s.path) !== null) throw new Fail('exists', s.path);
        tree.now.set(s.path, fileLines.length === 0 ? '' : `${fileLines.join('\n')}\n`);
      };
    }
    if (s.kind === 'delete') {
      for (const r of s.raw) throw new Exit2(`error: parse ${r.no}`);
      return (tree: Tree) => {
        if (!safe(s.path)) throw new Fail('unsafe', s.path);
        if (tree.get(s.path) === null) throw new Fail('missing', s.path);
        tree.now.set(s.path, null);
      };
    }
    let moveTo: string | null = null;
    let idx = 0;
    if (s.raw.length > 0 && s.raw[0]!.text.startsWith('*** Move to: ')) {
      moveTo = s.raw[0]!.text.slice('*** Move to: '.length).trim();
      idx = 1;
    }
    interface VChunk {
      anchor: string | null;
      body: BodyLine[];
      eof: boolean;
    }
    const chunks: VChunk[] = [];
    let curChunk: VChunk | null = null;
    let firstChunk = true;
    let afterEof = false;
    let strayEof: number | null = null;
    for (let j = idx; j < s.raw.length; j++) {
      const r = s.raw[j]!;
      const line = r.text;
      if (line.startsWith('@@')) {
        if (curChunk !== null) chunks.push(curChunk);
        const anchor = line.slice(2).trim();
        curChunk = { anchor: anchor === '' ? null : anchor, body: [], eof: false };
        firstChunk = false;
        afterEof = false;
        continue;
      }
      if (line === '' || line.startsWith(' ') || line.startsWith('-') || line.startsWith('+')) {
        if (curChunk === null) {
          if (!firstChunk || afterEof) throw new Exit2(`error: parse ${r.no}`);
          curChunk = { anchor: null, body: [], eof: false };
        }
        curChunk.body.push(parseBodyLine(line));
        continue;
      }
      if (line.trim() === '*** End of File') {
        if (curChunk === null) {
          if (strayEof === null) strayEof = r.no;
          continue;
        }
        curChunk.eof = true;
        chunks.push(curChunk);
        curChunk = null;
        afterEof = true;
        continue;
      }
      throw new Exit2(`error: parse ${r.no}`);
    }
    if (curChunk !== null) chunks.push(curChunk);
    if (chunks.length === 0 && moveTo === null) throw new Exit2(`error: parse ${s.lineNo}`);
    if (strayEof !== null) throw new Exit2(`error: parse ${strayEof}`);
    return (tree: Tree) => {
      if (!safe(s.path)) throw new Fail('unsafe', s.path);
      if (moveTo !== null && !safe(moveTo)) throw new Fail('unsafe', moveTo);
      const before = tree.get(s.path);
      if (before === null) throw new Fail('missing', s.path);
      if (moveTo !== null && tree.get(moveTo) !== null) throw new Fail('exists', moveTo);
      const doc = parseFile(before);
      let cursor = 0;
      for (const ch of chunks) {
        if (ch.anchor !== null) {
          const found = findTier(doc.lines, [ch.anchor], cursor, strict);
          if (!found) throw new Fail('no-match', s.path);
          cursor = found.pos[0]! + 1;
        }
        const on = splitBody(ch.body);
        if (on.o.length === 0) {
          const at = ch.eof ? doc.lines.length : cursor;
          const nl = on.n.map((e) => e.text);
          doc.lines.splice(at, 0, ...nl);
          cursor = at + nl.length;
        } else {
          const tiers = strict ? [0] : [0, 1, 2];
          let found: { tier: number; pos: number[] } | null = null;
          for (const t of tiers) {
            let pos = occurrences(doc.lines, on.o, t, cursor);
            if (ch.eof) pos = pos.filter((p) => p + on.o.length === doc.lines.length);
            if (pos.length > 0) {
              found = { tier: t, pos };
              break;
            }
          }
          if (!found) throw new Fail('no-match', s.path);
          const at = found.pos[0]!;
          const nl = buildNewLines(on, doc.lines, at, found.tier);
          doc.lines.splice(at, on.o.length, ...nl);
          cursor = at + nl.length;
        }
      }
      const out = writeFileDoc(doc);
      if (moveTo !== null) {
        tree.now.set(moveTo, out);
        tree.now.set(s.path, null);
        recordedMoves.push({ old: s.path, new: moveTo });
      } else {
        tree.now.set(s.path, out);
      }
    };
  });
}

function run(args: string[]): { code: number; out: string[] } {
  recordedMoves.length = 0;
  let format: string | null = null;
  let check = false;
  let strict = false;
  const pos: string[] = [];
  let ended = false;
  for (const a of args) {
    if (!ended && a === '--') ended = true;
    else if (!ended && a.startsWith('-') && a !== '-') {
      if (a.startsWith('--format=') && format === null && FORMATS.includes(a.slice(9))) format = a.slice(9);
      else if (a === '--check' && !check) check = true;
      else if (a === '--strict' && !strict) strict = true;
      else return { code: 2, out: ['error: usage'] };
    } else pos.push(a);
  }
  if (pos.length > 1) return { code: 2, out: ['error: usage'] };
  const file = pos.length === 0 || pos[0] === '-' ? null : pos[0]!;
  let text = '';
  try {
    text = readFileSync(file ?? 0, 'utf8');
  } catch {
    if (file !== null) return { code: 2, out: ['error: no-patch'] };
  }
  const lines = patchLines(text);
  const kind = format === null || format === 'auto' ? detect(lines) : format;
  if (kind === null) return { code: 2, out: ['error: format'] };
  let edits: Edit[];
  try {
    edits = kind === 'json' ? jsonEdits(text, lines) : kind === 'unified' ? unifiedEdits(lines, strict) : kind === 'search-replace' ? srEdits(lines, strict) : v4aEdits(lines, strict);
    if (edits.length === 0) throw new Exit2('error: parse 1');
  } catch (e) {
    if (e instanceof Exit2) return { code: 2, out: [e.line] };
    throw e;
  }
  const tree = new Tree();
  const fails: Fail[] = [];
  for (const edit of edits) {
    const before = new Map(tree.now);
    try {
      edit(tree);
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      tree.now.clear();
      for (const [k, v] of before) tree.now.set(k, v);
      fails.push(e);
    }
  }
  if (fails.length > 0) return { code: 1, out: [...fails.map((f) => `error: ${f.code} ${f.path}`), `failed: ${fails.length} of ${edits.length} edits`] };
  const changes: { key: string; line: string }[] = [];
  const covered = new Set<string>();
  for (const m of recordedMoves) {
    if (tree.original(m.old) !== null && tree.get(m.old) === null && tree.original(m.new) === null && tree.get(m.new) !== null) {
      covered.add(m.old);
      covered.add(m.new);
      changes.push({ key: m.new, line: `R ${m.old} -> ${m.new}` });
    }
  }
  for (const p of tree.now.keys()) {
    const was = tree.original(p);
    const now = tree.now.get(p)!;
    if (was === now) continue;
    if (covered.has(p)) continue;
    changes.push({ key: p, line: `${was === null ? 'A' : now === null ? 'D' : 'M'} ${p}` });
  }
  changes.sort((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)));
  const rows = changes.map((c) => c.line);
  if (!check) {
    for (const p of tree.now.keys()) {
      const was = tree.original(p);
      const now = tree.now.get(p)!;
      if (was === now) continue;
      if (now === null) rmSync(p, { force: true });
      else {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, now);
      }
    }
  }
  return { code: 0, out: [...rows, `ok: ${rows.length} ${rows.length === 1 ? 'file' : 'files'}`] };
}


const trialEnv = process.env.MAKEFUN_ENV_URL;
if (trialEnv !== undefined && trialEnv !== '') {
  // A trial: the kit's runner reads the checks from the env and runs this file on each one, without this variable.
  const { runTrial } = await import('./runner.ts');
  await runTrial(trialEnv);
} else {
  const r = run(process.argv.slice(2));
  writeSync(1, r.out.map((l) => `${l}\n`).join(''));
  process.exitCode = r.code;
}
