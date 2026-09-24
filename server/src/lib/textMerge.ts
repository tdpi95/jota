// Line-based diff + three-way merge, backing the WebDAV sync conflict view
// (PLAN.md "Remote & cloud sync" #3 — "Resolving a conflict"). Pure
// functions over strings, no I/O, no dependency on git (the WebDAV provider
// must keep working on a machine with git uninstalled). Nothing here ever
// decides a conflict on its own: `merge3` only combines edits that don't
// overlap, and hands every overlapping region back as a `conflict` chunk
// for the user to pick from.

export type DiffOp = { type: 'equal' | 'insert' | 'delete'; text: string };

/** Splits on `\n` only — a trailing newline yields a trailing `''` line, so
 * `joinLines(splitLines(s)) === s` for every string. */
export function splitLines(text: string): string[] {
  return text.split('\n');
}

export function joinLines(lines: string[]): string {
  return lines.join('\n');
}

/** Above this many edits Myers' trace gets expensive (memory is ~D²), and a
 * diff that large is "the whole file was rewritten" anyway — past it, the
 * differing middle is reported as one delete-everything/insert-everything
 * block instead. */
const MAX_EDIT_DISTANCE = 2000;

/** Myers' O((N+M)·D) shortest edit script, over lines. */
function myers(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((text) => ({ type: 'insert', text }));
  if (m === 0) return a.map((text) => ({ type: 'delete', text }));

  const max = n + m;
  const limit = Math.min(max, MAX_EDIT_DISTANCE);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  // trace[d] = the slice of `v` for k in [-(d+1), d+1] as it stood *before*
  // step d — all that backtracking step d ever reads.
  const trace: Int32Array[] = [];

  for (let d = 0; d <= limit; d++) {
    trace.push(v.slice(offset - (d + 1), offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(a, b, trace);
    }
  }

  return [...a.map((text): DiffOp => ({ type: 'delete', text })), ...b.map((text): DiffOp => ({ type: 'insert', text }))];
}

function backtrack(a: string[], b: string[], trace: Int32Array[]): DiffOp[] {
  const ops: DiffOp[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = trace.length - 1; d >= 0; d--) {
    const snap = trace[d];
    const at = (k: number) => snap[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ type: 'equal', text: a[x - 1] });
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) ops.push({ type: 'insert', text: b[y - 1] });
      else ops.push({ type: 'delete', text: a[x - 1] });
    }
    x = prevX;
    y = prevY;
  }
  return ops.reverse();
}

/** Line diff turning `a` into `b`. Common prefix/suffix are trimmed before
 * running Myers, so the usual "one paragraph changed in a long file" case
 * costs almost nothing. */
export function diffLines(a: string[], b: string[]): DiffOp[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const equal = (text: string): DiffOp => ({ type: 'equal', text });
  return [...a.slice(0, start).map(equal), ...myers(a.slice(start, endA), b.slice(start, endB)), ...a.slice(endA).map(equal)];
}

export interface DiffHunkLine {
  type: ' ' | '+' | '-';
  text: string;
}

export interface DiffHunk {
  /** 1-based line numbers where this hunk starts in the old/new text. */
  oldStart: number;
  newStart: number;
  lines: DiffHunkLine[];
}

/** Unified-diff-style hunks (changed lines plus `context` unchanged lines on
 * either side), for display. Empty when the two texts are identical. */
export function diffHunks(oldText: string, newText: string, context = 3): DiffHunk[] {
  const ops = diffLines(splitLines(oldText), splitLines(newText));
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let trailingEqual = 0;
  let oldLine = 1;
  let newLine = 1;

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.type === 'equal') {
      if (current) {
        // Keep the equal line if another change follows within 2×context
        // (the hunks would touch), or while still inside trailing context.
        let nextChange = i + 1;
        while (nextChange < ops.length && ops[nextChange].type === 'equal') nextChange++;
        const gap = nextChange - i;
        if (nextChange < ops.length && gap <= context * 2) {
          current.lines.push({ type: ' ', text: op.text });
        } else if (trailingEqual < context) {
          current.lines.push({ type: ' ', text: op.text });
          trailingEqual++;
        } else {
          hunks.push(current);
          current = null;
        }
      }
      oldLine++;
      newLine++;
      continue;
    }

    if (!current) {
      const lead: DiffHunkLine[] = [];
      for (let j = Math.max(0, i - context); j < i; j++) lead.push({ type: ' ', text: ops[j].text });
      current = { oldStart: oldLine - lead.length, newStart: newLine - lead.length, lines: lead };
    }
    trailingEqual = 0;
    if (op.type === 'delete') {
      current.lines.push({ type: '-', text: op.text });
      oldLine++;
    } else {
      current.lines.push({ type: '+', text: op.text });
      newLine++;
    }
  }
  if (current) hunks.push(current);
  return hunks;
}

export type MergeChunk =
  | { kind: 'ok'; lines: string[] }
  /** `base` is null for a two-way merge (no last-synced copy to compare
   * against), where there's no telling which side made a given change. */
  | { kind: 'conflict'; local: string[]; remote: string[]; base: string[] | null };

/** For each line of `a`, the index of the line it's matched to in `b` by the
 * diff, or -1 if it was deleted. */
function matchIndices(a: string[], b: string[]): Int32Array {
  const match = new Int32Array(a.length).fill(-1);
  let i = 0;
  let j = 0;
  for (const op of diffLines(a, b)) {
    if (op.type === 'equal') match[i++] = j++;
    else if (op.type === 'delete') i++;
    else j++;
  }
  return match;
}

function sameLines(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i]);
}

function pushChunk(chunks: MergeChunk[], chunk: MergeChunk): void {
  if (chunk.kind === 'ok') {
    if (chunk.lines.length === 0) return;
    const last = chunks[chunks.length - 1];
    if (last?.kind === 'ok') {
      last.lines.push(...chunk.lines);
      return;
    }
  }
  chunks.push(chunk);
}

/**
 * diff3-style three-way merge. Walks the base, advancing through "stable"
 * runs (lines both sides kept unchanged) and, between them, "unstable"
 * regions: if only one side changed a region, that side's version is taken;
 * if both made the identical change, it's taken once; otherwise it's a
 * `conflict` chunk carrying all three versions.
 */
export function merge3(baseText: string, localText: string, remoteText: string): MergeChunk[] {
  const base = splitLines(baseText);
  const local = splitLines(localText);
  const remote = splitLines(remoteText);
  const toLocal = matchIndices(base, local);
  const toRemote = matchIndices(base, remote);
  const chunks: MergeChunk[] = [];

  let i = 0;
  let j = 0;
  let k = 0;
  while (i < base.length || j < local.length || k < remote.length) {
    const stable: string[] = [];
    while (i < base.length && toLocal[i] === j && toRemote[i] === k) {
      stable.push(base[i]);
      i++;
      j++;
      k++;
    }
    pushChunk(chunks, { kind: 'ok', lines: stable });

    let nextI = i;
    while (nextI < base.length && (toLocal[nextI] < 0 || toRemote[nextI] < 0)) nextI++;
    const nextJ = nextI < base.length ? toLocal[nextI] : local.length;
    const nextK = nextI < base.length ? toRemote[nextI] : remote.length;
    if (nextI === i && nextJ === j && nextK === k) break; // nothing left

    const b = base.slice(i, nextI);
    const l = local.slice(j, nextJ);
    const r = remote.slice(k, nextK);
    if (sameLines(l, b)) pushChunk(chunks, { kind: 'ok', lines: r });
    else if (sameLines(r, b) || sameLines(l, r)) pushChunk(chunks, { kind: 'ok', lines: l });
    else pushChunk(chunks, { kind: 'conflict', local: l, remote: r, base: b });

    i = nextI;
    j = nextJ;
    k = nextK;
  }
  return chunks;
}

/** Two-way fallback when there's no base: lines both versions share are
 * kept, every region where they differ is a `conflict` chunk — without a
 * base there's no way to know which side made the change, so nothing is
 * combined automatically. */
export function merge2(localText: string, remoteText: string): MergeChunk[] {
  const chunks: MergeChunk[] = [];
  let local: string[] = [];
  let remote: string[] = [];
  const flush = () => {
    if (local.length > 0 || remote.length > 0) chunks.push({ kind: 'conflict', local, remote, base: null });
    local = [];
    remote = [];
  };
  for (const op of diffLines(splitLines(remoteText), splitLines(localText))) {
    if (op.type === 'equal') {
      flush();
      pushChunk(chunks, { kind: 'ok', lines: [op.text] });
    } else if (op.type === 'insert') {
      local.push(op.text);
    } else {
      remote.push(op.text);
    }
  }
  flush();
  return chunks;
}
