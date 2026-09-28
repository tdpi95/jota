import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Annotation, Compartment, EditorState, findClusterBreak, RangeSetBuilder, StateEffect, StateField, Transaction } from '@codemirror/state';
import { Decoration, drawSelection, dropCursor, EditorView, keymap, placeholder as placeholderExt, showTooltip, ViewPlugin, WidgetType } from '@codemirror/view';
import type { DecorationSet, Tooltip, ViewUpdate } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';

import { currentSealer } from '../lib/encryption';
import { findRegions, hasSentinels, openableTokens, REGION_CLOSE, REGION_OPEN, sealRegions, stripSentinels } from '../lib/encryptedRegions';
import type { SealedRegion } from '../lib/encryptedRegions';
import { findEncryptedTokens } from '../lib/encryptionCrypto';
import { VscodeSearchPanel } from '../lib/vscodeSearchPanel';

/**
 * VS Code-style *source* highlighting for markdown — the raw text stays
 * exactly as typed (no marks are hidden, nothing is rendered as rich HTML,
 * unlike Obsidian's live-preview mode), only colored/weighted by token:
 * headings/bold/italic/links/inline-code/quotes each get a distinct look,
 * and plain syntax punctuation (#, *, `, >, -, [], fences) is dimmed to
 * `--md-mark` so it reads as structure rather than content. Colors are CSS
 * custom properties (app.css) so this follows the active theme/palette
 * without redefining the style.
 */
const markdownHighlightStyle = HighlightStyle.define([
  { tag: [t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], color: 'var(--md-heading)', fontWeight: '700' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, color: 'var(--md-mark)', textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--md-link)' },
  { tag: t.url, color: 'var(--md-url)', textDecoration: 'underline' },
  // No backgroundColor here — it would tag *every* monospace token
  // (@lezer/markdown's grammar gives inline code and fenced/indented code
  // blocks the same `monospace` tag, with no way to tell them apart at this
  // level), so it'd paint a tight per-character background behind fenced
  // code's text on top of codeBlockBackground's full-line one below,
  // visibly doubling up wherever the two overlapped. Inline code's own tight
  // chip background is added separately by inlineCodeBackground, which can
  // tell the two apart by walking the actual syntax tree.
  { tag: t.monospace, color: 'var(--md-code)' },
  { tag: t.quote, color: 'var(--md-quote)', fontStyle: 'italic' },
  // No separate rule for t.list: @lezer/markdown maps "BulletList/... OrderedList/..."
  // to tags.list *recursively* (the "/..." matches every descendant, not just
  // the bullet), so styling t.list would bleed onto every bold/code/link
  // inside any list item, on top of (and fighting with) that token's own
  // rule. The bullet/number mark itself is already covered below via
  // ListMark, which the grammar tags as processingInstruction, not list.
  { tag: [t.processingInstruction, t.contentSeparator, t.escape, t.labelName], color: 'var(--md-mark)' },
  { tag: t.comment, color: 'var(--md-mark)', fontStyle: 'italic' },
  { tag: t.string, color: 'var(--md-quote)', fontStyle: 'italic' },
]);

/**
 * Gives fenced (```) and indented code blocks a background spanning the
 * full editor width, not just tight text-level highlighting — `t.monospace`
 * above still colors the text itself, but a HighlightStyle rule can only
 * paint the characters it matches, never the empty space to their right on
 * a short line. Scoped to `FencedCode`/`CodeBlock` nodes specifically (not
 * `InlineCode`) so a single-backtick inline code span stays a tight inline
 * chip rather than also growing a full-width band.
 */
const CODE_BLOCK_NODE_NAMES = new Set(['FencedCode', 'CodeBlock']);

function codeBlockLineDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  syntaxTree(state).iterate({
    enter: (node) => {
      if (!CODE_BLOCK_NODE_NAMES.has(node.name)) return;
      const startLine = state.doc.lineAt(node.from).number;
      const endLine = state.doc.lineAt(node.to).number;
      for (let lineNo = startLine; lineNo <= endLine; lineNo++) {
        const classes = ['cm-code-block-line'];
        if (lineNo === startLine) classes.push('cm-code-block-start');
        if (lineNo === endLine) classes.push('cm-code-block-end');
        const line = state.doc.line(lineNo);
        builder.add(line.from, line.from, Decoration.line({ class: classes.join(' ') }));
      }
    },
  });
  return builder.finish();
}

const codeBlockBackground = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = codeBlockLineDecorations(view.state);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || syntaxTree(update.state) !== syntaxTree(update.startState)) {
        this.decorations = codeBlockLineDecorations(update.state);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/**
 * The tight background chip for a single-backtick inline code span — kept
 * as its own tree-walked mark decoration (same reasoning as
 * codeBlockLineDecorations above: `t.monospace` alone can't distinguish
 * `InlineCode` from a fenced/indented code block) rather than a
 * HighlightStyle color rule, specifically so it never applies inside a
 * `FencedCode`/`CodeBlock` and doubles up with that block's own full-line
 * background.
 */
function inlineCodeDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'InlineCode') return;
      builder.add(node.from, node.to, Decoration.mark({ class: 'cm-inline-code' }));
    },
  });
  return builder.finish();
}

const inlineCodeBackground = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = inlineCodeDecorations(view.state);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || syntaxTree(update.state) !== syntaxTree(update.startState)) {
        this.decorations = inlineCodeDecorations(update.state);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/**
 * Encryption in the editor (milestone 31, PLAN.md "Encryption"). The body
 * this editor takes and hands back (`value`/`onChange`) only ever holds
 * encrypted `` `jota-enc:...` `` tokens. While the session is unlocked, the
 * editor's own document opens each token it can decrypt into an *editable
 * region*: its plaintext between two hidden sentinel characters
 * (lib/encryptedRegions.ts), highlighted and typed into like any other text.
 * Every edit re-seals the regions into tokens before `onChange` sees the
 * body, so autosave, git and disk only ever get ciphertext. Locking closes
 * every region back into its token (and drops undo history, which would
 * otherwise still hold the plaintext).
 *
 * A token that isn't open (locked, can't be decrypted with this passphrase,
 * or still decrypting) is an atomic chip; clicking it asks to unlock.
 */
export interface EditorEncryption {
  unlocked: boolean;
  /** Plaintext per token payload once decrypted, or 'error' when the
   * session passphrase can't open it; missing = locked. */
  decrypted: Map<string, string | 'error'>;
  labels: { locked: string; error: string; encrypt: string; remove: string };
  /** Before "Encrypt" turns a selection into a region — resolves false if
   * the user cancelled the passphrase prompt. */
  ensureUnlockedForEncrypt: () => Promise<boolean>;
  /** Before "Remove encryption" saves a region as plain text for good. */
  confirmRemove: () => boolean;
  onTokenClick: (payload: string) => void;
  /** A token this editor just sealed a region into, and its plaintext —
   * so the page needn't decrypt what the editor already knows. */
  onSealed: (payload: string, plaintext: string) => void;
}

type EncryptionRef = { current: EditorEncryption | undefined };

class EncryptedTokenWidget extends WidgetType {
  constructor(
    readonly payload: string,
    readonly status: 'locked' | 'error' | 'unlocked',
    readonly text: string,
    readonly encryption: EncryptionRef,
  ) {
    super();
  }
  eq(other: EncryptedTokenWidget) {
    return other.payload === this.payload && other.status === this.status && other.text === this.text;
  }
  toDOM() {
    const el = document.createElement('span');
    el.className = `cm-enc-token is-${this.status}`;
    el.textContent = this.status === 'unlocked' ? this.text : `🔒 ${this.text}`;
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.encryption.current?.onTokenClick(this.payload);
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

/** The visible edges of an open region; the sentinel characters themselves
 * are hidden behind these. */
class RegionEdgeWidget extends WidgetType {
  constructor(readonly edge: 'start' | 'end') {
    super();
  }
  eq(other: RegionEdgeWidget) {
    return other.edge === this.edge;
  }
  toDOM() {
    const el = document.createElement('span');
    el.className = `cm-enc-edge is-${this.edge}`;
    if (this.edge === 'start') el.textContent = '🔓';
    return el;
  }
}

const setDecryptedEffect = StateEffect.define<Map<string, string | 'error'>>();

function buildTokenDecorations(state: EditorState, decrypted: Map<string, string | 'error'>, encryption: EncryptionRef): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const labels = encryption.current?.labels;
  for (const token of findEncryptedTokens(state.doc.toString())) {
    const value = decrypted.get(token.payload);
    const widget =
      value === undefined
        ? new EncryptedTokenWidget(token.payload, 'locked', labels?.locked ?? '', encryption)
        : value === 'error'
          ? new EncryptedTokenWidget(token.payload, 'error', labels?.error ?? '', encryption)
          : new EncryptedTokenWidget(token.payload, 'unlocked', value, encryption);
    builder.add(token.from, token.to, Decoration.replace({ widget }));
  }
  return builder.finish();
}

function encryptedTokensField(encryption: EncryptionRef) {
  return StateField.define<{ decrypted: Map<string, string | 'error'>; decorations: DecorationSet }>({
    create: (state) => {
      const decrypted = encryption.current?.decrypted ?? new Map();
      return { decrypted, decorations: buildTokenDecorations(state, decrypted, encryption) };
    },
    update: (value, tr) => {
      let decrypted = value.decrypted;
      for (const e of tr.effects) if (e.is(setDecryptedEffect)) decrypted = e.value;
      if (!tr.docChanged && decrypted === value.decrypted) return value;
      return { decrypted, decorations: buildTokenDecorations(tr.state, decrypted, encryption) };
    },
    provide: (f) => [
      EditorView.decorations.from(f, (v) => v.decorations),
      EditorView.atomicRanges.of((view) => view.state.field(f).decorations),
    ],
  });
}

const regionStart = Decoration.replace({ widget: new RegionEdgeWidget('start') });
const regionEnd = Decoration.replace({ widget: new RegionEdgeWidget('end') });
const regionText = Decoration.mark({ class: 'cm-enc-region' });

function buildRegionDecorations(state: EditorState): { decorations: DecorationSet; edges: DecorationSet } {
  const decorations = new RangeSetBuilder<Decoration>();
  const edges = new RangeSetBuilder<Decoration>();
  for (const r of findRegions(state.doc.toString())) {
    decorations.add(r.open, r.open + 1, regionStart);
    edges.add(r.open, r.open + 1, regionStart);
    if (r.close > r.open + 1) decorations.add(r.open + 1, r.close, regionText);
    if (r.close < state.doc.length) {
      decorations.add(r.close, r.close + 1, regionEnd);
      edges.add(r.close, r.close + 1, regionEnd);
    }
  }
  return { decorations: decorations.finish(), edges: edges.finish() };
}

const regionsField = StateField.define<{ decorations: DecorationSet; edges: DecorationSet }>({
  create: buildRegionDecorations,
  update: (value, tr) => (tr.docChanged ? buildRegionDecorations(tr.state) : value),
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.decorations),
    // Only the (hidden) sentinels are atomic — the text between them is
    // ordinary editable text.
    EditorView.atomicRanges.of((view) => view.state.field(f).edges),
  ],
});

// Marks a programmatic rewrite that doesn't change the body — pushing an
// externally-changed `value` prop into the doc, or opening/closing regions
// on unlock/lock — as opposed to real user input. The updateListener skips
// these so `onChange` never fires for a change the caller itself supplied:
// without that, every external `value` update (e.g. the journal entry
// finishing its initial fetch) round-tripped back through `onChange`
// indistinguishably from a real edit, and JournalDayPage's autosave scheduled
// a pointless save on every page load. `keepRegionsBalanced` skips them too.
const externalValueSync = Annotation.define<boolean>();
// This editor's own region edits (encrypt a selection, remove encryption):
// real edits, but allowed to add/remove sentinels.
const regionEdit = Annotation.define<boolean>();

function clusterBefore(state: EditorState, pos: number): number {
  const line = state.doc.lineAt(pos);
  return pos === line.from ? pos - 1 : line.from + findClusterBreak(line.text, pos - line.from, false);
}

function clusterAfter(state: EditorState, pos: number): number {
  const line = state.doc.lineAt(pos);
  return pos === line.to ? pos + 1 : line.from + findClusterBreak(line.text, pos - line.from, true);
}

/**
 * A region's two sentinels are only ever removed together, so no edit can
 * turn encrypted text into plain text by accident (only "Remove encryption"
 * does that):
 * - Backspace/Delete on a region edge steps over the hidden sentinel and
 *   deletes the character beyond it instead.
 * - Any other edit that would take just one sentinel (a selection spanning
 *   a region edge, deleted or typed over) puts that sentinel back at the
 *   edit, so the region shrinks to what's left of it — anything typed there
 *   lands inside the region.
 * - Nothing but undo/redo may insert a sentinel (pastes are stripped by the
 *   clipboard filter).
 */
const keepRegionsBalanced = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.annotation(externalValueSync) || tr.annotation(regionEdit)) return tr;
  const undoRedo = tr.isUserEvent('undo') || tr.isUserEvent('redo');
  let insertsSentinel = false;
  tr.changes.iterChanges((_fA, _tA, _fB, _tB, text) => {
    if (hasSentinels(text.toString())) insertsSentinel = true;
  });
  if (insertsSentinel && !undoRedo) return [];
  const start = tr.startState;
  const before = start.doc.toString();
  if (!hasSentinels(before)) return tr;

  const deletedAt = (pos: number) => {
    let hit = false;
    tr.changes.iterChangedRanges((fA, tA) => {
      if (pos >= fA && pos < tA) hit = true;
    });
    return hit;
  };
  const lone: { pos: number; char: string }[] = [];
  for (const r of findRegions(before)) {
    const open = deletedAt(r.open);
    const close = r.close < before.length ? deletedAt(r.close) : open;
    if (open && !close) lone.push({ pos: r.open, char: REGION_OPEN });
    if (close && !open) lone.push({ pos: r.close, char: REGION_CLOSE });
  }
  if (lone.length === 0) return tr;

  // Backspace/Delete of exactly one sentinel: skip over it.
  let single: { fromA: number; toA: number; empty: boolean } | null = null;
  let count = 0;
  tr.changes.iterChanges((fA, tA, _fB, _tB, text) => {
    count++;
    single = { fromA: fA, toA: tA, empty: text.length === 0 };
  });
  const s = single as { fromA: number; toA: number; empty: boolean } | null;
  if (count === 1 && s && s.empty && s.toA - s.fromA === 1 && lone.length === 1 && start.selection.main.empty && tr.isUserEvent('delete')) {
    const backward = start.selection.main.head > s.fromA;
    const from = backward ? clusterBefore(start, s.fromA) : s.toA;
    const to = backward ? s.fromA : clusterAfter(start, s.toA);
    const outOfDoc = from < 0 || to > start.doc.length;
    if (outOfDoc || hasSentinels(start.sliceDoc(from, to))) return { selection: { anchor: backward ? s.fromA : s.toA } };
    return { changes: { from, to }, selection: { anchor: from }, userEvent: backward ? 'delete.backward' : 'delete.forward', scrollIntoView: true };
  }

  // Otherwise put each lone sentinel back where its part of the edit landed:
  // an opening one before that change's inserted text, a closing one after.
  const restore: { from: number; insert: string }[] = [];
  tr.changes.iterChanges((fA, tA, fB, tB) => {
    for (const l of lone) if (l.pos >= fA && l.pos < tA) restore.push({ from: l.char === REGION_OPEN ? fB : tB, insert: l.char });
  });
  return [
    { changes: tr.changes, selection: tr.selection, effects: tr.effects, scrollIntoView: tr.scrollIntoView, userEvent: tr.annotation(Transaction.userEvent) },
    { changes: restore, sequential: true },
  ];
});

/** Whether a mouse button or key is held — the selection popup waits for
 * its release, so it doesn't pop up (and follow along) mid-drag. */
const setSelectionHeld = StateEffect.define<boolean>();

/** Tracks the press/release that `setSelectionHeld` reports. A press on the
 * popup itself doesn't count (that would hide it before its click lands);
 * the release is watched on the window, since a drag can end outside. */
const selectionHeldTracker = ViewPlugin.fromClass(
  class {
    held = false;
    constructor(readonly view: EditorView) {
      window.addEventListener('mouseup', this.release, true);
      window.addEventListener('keyup', this.release, true);
      window.addEventListener('blur', this.release);
    }
    press = (event: Event) => {
      if ((event.target as HTMLElement | null)?.closest?.('.cm-enc-popup')) return;
      this.set(true);
    };
    release = () => this.set(false);
    set(held: boolean) {
      if (this.held === held) return;
      this.held = held;
      // Not mid-update: the press handlers run from DOM events, never from
      // inside CodeMirror's own update cycle.
      this.view.dispatch({ effects: setSelectionHeld.of(held) });
    }
    destroy() {
      window.removeEventListener('mouseup', this.release, true);
      window.removeEventListener('keyup', this.release, true);
      window.removeEventListener('blur', this.release);
    }
  },
  {
    eventHandlers: {
      mousedown(event) {
        this.press(event);
      },
      keydown(event) {
        this.press(event);
      },
    },
  },
);

/** A right-click on an open encrypted region: the position the popup
 * offers "Remove encryption" at, or null to drop that offer. */
const setContextTarget = StateEffect.define<number | null>();

/** Right-clicking open encrypted text shows the popup's "Remove encryption"
 * there instead of the native context menu. Anywhere else the native menu
 * is left alone. */
const regionContextMenu = EditorView.domEventHandlers({
  contextmenu(event, view) {
    if (view.state.readOnly) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return false;
    const region = findRegions(view.state.doc.toString()).find((r) => r.open <= pos && pos <= r.close);
    if (!region) return false;
    event.preventDefault();
    // Clicking the region's start edge resolves to its opening sentinel —
    // step inside, so the position counts as touching the region.
    view.dispatch({ effects: setContextTarget.of(Math.max(pos, region.open + 1)) });
    return true;
  },
});

/** The small popup above a non-empty selection: "Encrypt" it, or "Remove
 * encryption" from the region(s) it touches — or, after a right-click on
 * open encrypted text, "Remove encryption" at that spot. Shown only once
 * the selection is made — after the mouse button or key is released. */
function selectionPopupField(encryption: EncryptionRef, actions: { current: { encrypt: (from: number, to: number) => void; remove: (from: number, to: number) => void } }) {
  const popup = (pos: number, action: 'encrypt' | 'remove', from: number, to: number): Tooltip => ({
    pos,
    above: true,
    create: () => {
      const dom = document.createElement('div');
      dom.className = 'cm-enc-popup';
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${action === 'remove' ? '🔓' : '🔒'} ${encryption.current?.labels[action] ?? action}`;
      button.addEventListener('mousedown', (e) => e.preventDefault());
      button.addEventListener('click', () => actions.current[action](from, to));
      dom.appendChild(button);
      return { dom };
    },
  });
  const compute = (state: EditorState, context: number | null): readonly Tooltip[] => {
    if (state.readOnly || !encryption.current) return [];
    if (context !== null) return [popup(context, 'remove', context, context)];
    const { from, to } = state.selection.main;
    if (from === to) return [];
    const touchesRegion = findRegions(state.doc.toString()).some((r) => r.open < to && r.close + 1 > from);
    const action = touchesRegion ? 'remove' : 'encrypt';
    if (action === 'encrypt' && !state.sliceDoc(from, to).trim()) return [];
    return [popup(from, action, from, to)];
  };
  type Value = { held: boolean; context: number | null; tooltips: readonly Tooltip[] };
  return StateField.define<Value>({
    create: (state) => ({ held: false, context: null, tooltips: compute(state, null) }),
    update: (value, tr) => {
      let { held, context } = value;
      let contextSet = false;
      for (const e of tr.effects) {
        if (e.is(setSelectionHeld)) {
          held = e.value;
          // Any new press (left click elsewhere, a key) dismisses the
          // right-click offer; a right-click's own press comes before its
          // contextmenu event, so it sets a fresh one right after.
          if (held) context = null;
        } else if (e.is(setContextTarget)) {
          context = e.value;
          contextSet = true;
        }
      }
      if (context !== null && !contextSet && (tr.docChanged || (tr.selection && !tr.state.selection.main.empty))) context = null;
      if (held) return value.tooltips.length === 0 && value.held && value.context === context ? value : { held, context, tooltips: [] };
      if (held !== value.held || context !== value.context || tr.docChanged || tr.selection) return { held, context, tooltips: compute(tr.state, context) };
      return value;
    },
    provide: (f) => showTooltip.computeN([f], (state) => state.field(f).tooltips),
  });
}

/** The smallest single change turning `from` into `to` — keeps the cursor
 * and scroll position where they were for an edit elsewhere in the text. */
function minimalChange(from: string, to: string): { from: number; to: number; insert: string } {
  let start = 0;
  while (start < from.length && start < to.length && from[start] === to[start]) start++;
  let endA = from.length;
  let endB = to.length;
  while (endA > start && endB > start && from[endA - 1] === to[endB - 1]) {
    endA--;
    endB--;
  }
  return { from: start, to: endA, insert: to.slice(start, endB) };
}

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Pasting a file (an image copied from a screenshot tool, a file copied
   * from a file manager, ...) hands the pasted `FileList` here instead of
   * falling through to CodeMirror's default paste handling — there's no
   * useful text representation of a file paste anyway. Only content types
   * that support attachments (milestone 27, PLAN.md "File attachments")
   * pass this; a plain text/markdown paste is always handled normally. */
  onPasteFiles?: (files: FileList) => void;
  /** Focus the editor right after it mounts — used by the global "quick add
   * journal" keyboard shortcut, which navigates to today's entry expecting
   * to drop the user straight into typing rather than requiring an extra
   * click. Read only at creation, same as `placeholder`. */
  autoFocus?: boolean;
  /** Encryption (milestone 31): editable regions while unlocked, the
   * selection popup, and chips for tokens that aren't open. Without it
   * tokens still render as (inert) lock chips and there's no popup.
   * `labels` are read at creation; the rest is followed live. */
  encryption?: EditorEncryption;
}

/** Imperative handle (via `ref`) for the one thing a *page* needs to drive
 * from outside — it exists specifically because a page-level Cmd/Ctrl+F
 * shortcut (`useFindShortcut`) can't rely on this editor already having
 * focus, or even being mounted at all (a page's Preview mode unmounts it
 * entirely): `openFind` focuses the view and opens/refocuses the find panel
 * in one call, safe to call as soon as the editor has mounted. */
export interface MarkdownEditorHandle {
  openFind: () => void;
}

/**
 * A CodeMirror 6-backed replacement for the plain `<textarea>` journal body
 * used to use (see MarkdownTextarea.tsx, still used as-is for task/project
 * descriptions) — same controlled-value contract, but with markdown syntax
 * highlighting live as you type. Deliberately *not* a rendered/WYSIWYG
 * preview: the stored value is still the raw markdown text untouched, this
 * only changes how it's colored on screen.
 */
const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(function MarkdownEditor(
  { value, onChange, placeholder, disabled, className, onPasteFiles, autoFocus, encryption },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onPasteFilesRef = useRef(onPasteFiles);
  onPasteFilesRef.current = onPasteFiles;
  const encryptionRef = useRef(encryption);
  encryptionRef.current = encryption;
  const editableCompartment = useRef(new Compartment()).current;
  const historyCompartment = useRef(new Compartment()).current;
  const didAutoFocusRef = useRef(false);
  // The body as last handed out via `onChange` or taken in via `value` —
  // what the document currently stands for. While regions are open the
  // document itself differs from it (plaintext instead of tokens).
  const bodyRef = useRef(value);
  // Each open region's plaintext and the token it was last sealed into, so
  // an unedited region reseals to the same token.
  const sealedRef = useRef<SealedRegion[]>([]);
  // Bumped per edit and per external sync; a seal finishing after a newer
  // one started is dropped.
  const sealSeqRef = useRef(0);
  const sealingRef = useRef<Promise<void>>(Promise.resolve());
  // A selection waiting on the passphrase prompt to be encrypted.
  const pendingEncryptRef = useRef<{ from: number; to: number } | null>(null);

  useImperativeHandle(ref, () => ({
    openFind: () => {
      const view = viewRef.current;
      if (!view) return;
      view.focus();
      openSearchPanel(view);
    },
  }), []);

  function emitBody(doc: string) {
    const seq = ++sealSeqRef.current;
    if (!hasSentinels(doc)) {
      sealedRef.current = [];
      bodyRef.current = doc;
      onChangeRef.current(doc);
      return;
    }
    // Regions but no session (an edit landing just after a lock, before the
    // regions closed): there's nothing to seal them with, and plaintext must
    // never go out — the edit is dropped when the regions close.
    const encrypt = currentSealer();
    if (!encrypt) return;
    const previous = sealedRef.current;
    sealingRef.current = sealRegions(doc, previous, encrypt).then(
      ({ body, sealed }) => {
        if (seq !== sealSeqRef.current) return;
        const known = new Set(previous.map((r) => r.token));
        for (const r of sealed) if (!known.has(r.token)) encryptionRef.current?.onSealed(r.token.slice(1, -1), r.text);
        sealedRef.current = sealed;
        if (body === bodyRef.current) return;
        bodyRef.current = body;
        onChangeRef.current(body);
      },
      (err) => console.error('failed to seal encrypted text:', err),
    );
  }

  /** Opens every token in the document whose plaintext is known. */
  function openKnownTokens(view: EditorView) {
    const enc = encryptionRef.current;
    if (!enc?.unlocked) return;
    const { changes, sealed } = openableTokens(view.state.doc.toString(), enc.decrypted);
    if (changes.length === 0) return;
    sealedRef.current = [...sealedRef.current, ...sealed];
    view.dispatch({ changes, annotations: [externalValueSync.of(true), Transaction.addToHistory.of(false)] });
  }

  /** Closes every region back into its token — on lock. Waits for a seal
   * still in flight so the last edit isn't lost, then also drops undo
   * history: it holds the plaintext, and undoing past the close would put
   * that plaintext back as ordinary text. */
  function closeRegions() {
    void sealingRef.current.then(() => {
      const view = viewRef.current;
      if (!view || encryptionRef.current?.unlocked || !hasSentinels(view.state.doc.toString())) return;
      sealSeqRef.current++;
      sealedRef.current = [];
      view.dispatch({
        changes: minimalChange(view.state.doc.toString(), bodyRef.current),
        annotations: [externalValueSync.of(true), Transaction.addToHistory.of(false)],
      });
      view.dispatch({ effects: historyCompartment.reconfigure([]) });
      view.dispatch({ effects: historyCompartment.reconfigure(history()) });
    });
  }

  // The selection popup's two actions.
  const regionActionsRef = useRef({
    encrypt: async (from: number, to: number) => {
      const view = viewRef.current;
      const enc = encryptionRef.current;
      if (!view || !enc) return;
      const selected = view.state.sliceDoc(from, to);
      const inner = selected.trim();
      if (!inner) return;
      // Surrounding whitespace stays outside the region, so encrypting
      // "a word " mid-sentence keeps the sentence's spacing.
      const start = from + (selected.length - selected.trimStart().length);
      // Unlocking opens other tokens and shifts positions — the range is
      // mapped through every edit while the prompt is up (updateListener).
      const range = { from: start, to: start + inner.length };
      pendingEncryptRef.current = range;
      const ok = await enc.ensureUnlockedForEncrypt();
      pendingEncryptRef.current = null;
      const current = viewRef.current;
      if (!ok || !current || range.to <= range.from) return;
      // Tokens inside the selection that unlocking just opened merge into
      // the new region — regions don't nest.
      const inside = current.state.sliceDoc(range.from, range.to);
      const merged: { from: number; to: number }[] = [];
      for (let i = 0; i < inside.length; i++) {
        if (inside[i] === REGION_OPEN || inside[i] === REGION_CLOSE) merged.push({ from: range.from + i, to: range.from + i + 1 });
      }
      current.dispatch({
        changes: [{ from: range.from, insert: REGION_OPEN }, ...merged, { from: range.to, insert: REGION_CLOSE }],
        selection: { anchor: range.to + 2 - merged.length },
        annotations: regionEdit.of(true),
        userEvent: 'input.encrypt',
      });
      current.focus();
    },
    remove: (from: number, to: number) => {
      const view = viewRef.current;
      if (!view || !encryptionRef.current?.confirmRemove()) return;
      const doc = view.state.doc.toString();
      const changes: { from: number; to: number }[] = [];
      for (const r of findRegions(doc)) {
        if (!(r.open < to && r.close + 1 > from)) continue;
        changes.push({ from: r.open, to: r.open + 1 });
        if (r.close < doc.length) changes.push({ from: r.close, to: r.close + 1 });
      }
      if (changes.length === 0) return;
      view.dispatch({ changes, annotations: regionEdit.of(true), userEvent: 'delete.decrypt' });
      view.focus();
    },
  });

  // Created once per mount; external `value` changes after that are synced
  // by the effect below rather than tearing the view down (that would drop
  // cursor position/undo history on every keystroke-triggered parent
  // re-render). `placeholder` is read only at creation — none of this
  // component's call sites change it after mount.
  useEffect(() => {
    if (!containerRef.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          historyCompartment.of(history()),
          drawSelection(),
          dropCursor(),
          indentOnInput(),
          bracketMatching(),
          EditorView.lineWrapping,
          // Cmd/Ctrl+F find-in-editor (journal body, note body) — built on
          // CodeMirror's own search state/commands, but with a from-scratch
          // panel (`VscodeSearchPanel`, via `createPanel`) instead of the
          // default one: icon toggle buttons + a collapsible replace row
          // behind a chevron, VS Code-style, rather than a flat row of text
          // buttons and always-visible replace fields. `searchKeymap` also
          // carries F3/Cmd-G (find next/previous), Escape (close), and
          // Cmd-D (select next occurrence) — none of which collide with this
          // app's own global shortcuts (`KeyboardShortcuts.tsx`'s digit/,/T/J
          // bindings), so nothing needed to change there. `top: true` because
          // this editor has no internal scroll of its own (.journal-body grows
          // to fit its content instead of scrolling — see app.css) — the
          // default bottom-panel placement would insert the find bar *after*
          // every line, off past the bottom of the fold on anything longer
          // than a screenful, exactly where a user reaching for "find" isn't
          // looking.
          search({ top: true, createPanel: (searchView) => new VscodeSearchPanel(searchView) }),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          // No `codeLanguages` — that pulls in a lazy chunk per possible
          // fence info-string language (pug, nginx, verilog, ...) just to
          // syntax-color code *inside* fences, well past what "highlight
          // the markdown, VS Code-style" asked for. Fenced code still gets
          // the flat --md-code monospace look via tags.monospace below.
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(markdownHighlightStyle),
          codeBlockBackground,
          inlineCodeBackground,
          encryptedTokensField(encryptionRef),
          regionsField,
          keepRegionsBalanced,
          EditorView.clipboardOutputFilter.of((text) => stripSentinels(text)),
          EditorView.clipboardInputFilter.of((text) => stripSentinels(text)),
          selectionHeldTracker,
          regionContextMenu,
          selectionPopupField(encryptionRef, regionActionsRef),
          placeholderExt(placeholder ?? ''),
          editableCompartment.of([EditorView.editable.of(!disabled), EditorState.readOnly.of(!!disabled)]),
          EditorView.domEventHandlers({
            paste: (event) => {
              const files = event.clipboardData?.files;
              if (!files || files.length === 0 || !onPasteFilesRef.current) return false;
              event.preventDefault();
              onPasteFilesRef.current(files);
              return true;
            },
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const pending = pendingEncryptRef.current;
            if (pending) {
              pending.from = update.changes.mapPos(pending.from, 1);
              pending.to = update.changes.mapPos(pending.to, -1);
            }
            if (update.transactions.some((tr) => tr.annotation(externalValueSync))) return;
            emitBody(update.state.doc.toString());
          }),
        ],
      }),
      parent: containerRef.current,
    });
    viewRef.current = view;
    openKnownTokens(view);
    return () => {
      view.destroy();
      viewRef.current = null;
      // A fresh view hasn't been auto-focused yet — without this, React
      // StrictMode's dev-only destroy-and-recreate left the second view
      // unfocused, since the first one had already used up the one-time flag.
      didAutoFocusRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync value changes that came from outside (e.g. the journal entry
  // fetch resolving after the editor already mounted empty) — skip when it's
  // the body the document already stands for, so this never fights with the
  // user's own typing (each keystroke's onChange round-trips back through
  // `value`). Tokens it brings in open straight away while unlocked.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || value === bodyRef.current) return;
    sealSeqRef.current++;
    bodyRef.current = value;
    sealedRef.current = [];
    view.dispatch({ changes: minimalChange(view.state.doc.toString(), value), annotations: externalValueSync.of(true) });
    openKnownTokens(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const decrypted = encryption?.decrypted;
  const unlocked = encryption?.unlocked ?? false;
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !decrypted) return;
    view.dispatch({ effects: setDecryptedEffect.of(decrypted) });
    openKnownTokens(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decrypted]);

  useEffect(() => {
    if (!unlocked) closeRegions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: editableCompartment.reconfigure([EditorView.editable.of(!disabled), EditorState.readOnly.of(!!disabled)]),
    });
    // `autoFocus` can't be honored at creation time for a caller that also
    // passes `disabled` while its own data is still loading (JournalDayPage:
    // `disabled={entryQuery.isLoading}`) — CodeMirror's `editable: false`
    // makes the underlying contenteditable DOM node unfocusable, so a
    // `view.focus()` called while still disabled is silently a no-op. Doing
    // it here instead, gated on the transition to enabled, catches both that
    // case and the already-enabled-at-mount case (this effect also runs once
    // on mount). `didAutoFocusRef` keeps it a one-time thing so a later
    // disabled->enabled->disabled->enabled cycle doesn't keep stealing focus
    // back from wherever the user has since clicked.
    if (!disabled && autoFocus && !didAutoFocusRef.current) {
      didAutoFocusRef.current = true;
      viewRef.current?.focus();
    }
  }, [disabled, editableCompartment, autoFocus]);

  const classes = ['md-editor', className, disabled ? 'is-disabled' : ''].filter(Boolean).join(' ');
  return <div ref={containerRef} className={classes} />;
});

export default MarkdownEditor;
