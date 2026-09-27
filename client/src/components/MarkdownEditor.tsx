import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Annotation, Compartment, EditorState, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { Decoration, drawSelection, dropCursor, EditorView, keymap, placeholder as placeholderExt, showTooltip, ViewPlugin, WidgetType } from '@codemirror/view';
import type { DecorationSet, Tooltip, ViewUpdate } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';

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
 * Encrypted tokens (milestone 31, PLAN.md "Encryption") — each
 * `` `jota-enc:...` `` inline code span is replaced by one atomic inline
 * widget (the cursor skips over it, backspace deletes it whole): a lock chip
 * while locked, or — once the page has decrypted it — its plaintext, shown
 * in place but read-only (the document itself only ever holds the token, so
 * autosave and git only see ciphertext). Clicking the widget selects the
 * whole token, which brings up the selection popup below with "Decrypt".
 */
export interface EditorEncryption {
  /** Plaintext per token payload once decrypted, or 'error' when the
   * session passphrase can't open it; missing = locked. */
  decrypted: Map<string, string | 'error'>;
  labels: { locked: string; error: string; encrypt: string; decrypt: string };
  /** The selection popup's button: 'decrypt' when the selection touches an
   * encrypted token, otherwise 'encrypt'. */
  onSelectionAction: (action: 'encrypt' | 'decrypt', from: number, to: number) => void;
}

type EncryptionRef = { current: EditorEncryption | undefined };

class EncryptedTokenWidget extends WidgetType {
  constructor(
    readonly tokenLength: number,
    readonly status: 'locked' | 'error' | 'unlocked',
    readonly text: string,
  ) {
    super();
  }
  eq(other: EncryptedTokenWidget) {
    return other.tokenLength === this.tokenLength && other.status === this.status && other.text === this.text;
  }
  toDOM(view: EditorView) {
    const el = document.createElement('span');
    el.className = `cm-enc-token is-${this.status}`;
    el.textContent = this.status === 'unlocked' ? this.text : `🔒 ${this.text}`;
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const from = view.posAtDOM(el);
      view.dispatch({ selection: { anchor: from, head: from + this.tokenLength } });
      view.focus();
    });
    return el;
  }
  ignoreEvent() {
    return true;
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
        ? new EncryptedTokenWidget(token.to - token.from, 'locked', labels?.locked ?? '')
        : value === 'error'
          ? new EncryptedTokenWidget(token.to - token.from, 'error', labels?.error ?? '')
          : new EncryptedTokenWidget(token.to - token.from, 'unlocked', value);
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

/** The small popup above a non-empty selection: "Encrypt" it, or "Decrypt"
 * the encrypted token(s) it touches. */
function selectionPopupField(encryption: EncryptionRef) {
  const compute = (state: EditorState): readonly Tooltip[] => {
    const { from, to } = state.selection.main;
    if (from === to || state.readOnly || !encryption.current) return [];
    const action = findEncryptedTokens(state.doc.toString()).some((tok) => tok.from < to && tok.to > from) ? 'decrypt' : 'encrypt';
    if (action === 'encrypt' && !state.sliceDoc(from, to).trim()) return [];
    return [
      {
        pos: from,
        above: true,
        create: () => {
          const dom = document.createElement('div');
          dom.className = 'cm-enc-popup';
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = `${action === 'decrypt' ? '🔓' : '🔒'} ${encryption.current?.labels[action] ?? action}`;
          button.addEventListener('mousedown', (e) => e.preventDefault());
          button.addEventListener('click', () => encryption.current?.onSelectionAction(action, from, to));
          dom.appendChild(button);
          return { dom };
        },
      },
    ];
  };
  return StateField.define<readonly Tooltip[]>({
    create: compute,
    update: (tooltips, tr) => (tr.docChanged || tr.selection ? compute(tr.state) : tooltips),
    provide: (f) => showTooltip.computeN([f], (state) => state.field(f)),
  });
}

// Marks a transaction as a programmatic value-sync (the effect below,
// pushing an externally-changed `value` prop into the CM doc) rather than
// real user input — the updateListener checks for this to avoid calling
// `onChange` for a change the caller itself just supplied. Without it, every
// external `value` update (e.g. the journal entry finishing its initial
// fetch) round-tripped back through `onChange` indistinguishably from a real
// edit, which JournalDayPage's autosave couldn't tell apart from the user
// actually typing — scheduling a real (and pointless) autosave on every
// page load.
const externalValueSync = Annotation.define<boolean>();

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
  /** Encrypted-token display + the selection popup (milestone 31). Without
   * it tokens still render as (inert) lock chips and there's no popup.
   * `labels` are read at creation; `decrypted` is pushed in on change. */
  encryption?: EditorEncryption;
}

/** Imperative handle (via `ref`) for the two things a *page* needs to drive
 * from outside — both exist specifically because a page-level Cmd/Ctrl+F
 * shortcut (`useFindShortcut`) can't rely on this editor already having
 * focus, or even being mounted at all (a page's Preview mode unmounts it
 * entirely): `openFind` focuses the view and opens/refocuses the find panel
 * in one call, safe to call as soon as the editor has mounted. */
export interface MarkdownEditorHandle {
  openFind: () => void;
  /** Replaces `from..to` as a normal edit (keeps cursor/undo, fires
   * `onChange`) — only if that range still holds `expected`; returns
   * whether it did. Used to swap text for its encrypted token and back. */
  replaceRange: (from: number, to: number, insert: string, expected: string) => boolean;
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
  const didAutoFocusRef = useRef(false);

  useImperativeHandle(ref, () => ({
    openFind: () => {
      const view = viewRef.current;
      if (!view) return;
      view.focus();
      openSearchPanel(view);
    },
    replaceRange: (from, to, insert, expected) => {
      const view = viewRef.current;
      if (!view || to > view.state.doc.length || view.state.sliceDoc(from, to) !== expected) return false;
      view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: 'input' });
      view.focus();
      return true;
    },
  }), []);

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
          history(),
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
          selectionPopupField(encryptionRef),
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
            if (update.transactions.some((tr) => tr.annotation(externalValueSync))) return;
            onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
      parent: containerRef.current,
    });
    viewRef.current = view;
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
  // fetch resolving after the editor already mounted empty) — skip when
  // the doc already matches so this never fights with the user's own
  // typing (each keystroke's onChange round-trips back through `value`).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: value }, annotations: externalValueSync.of(true) });
  }, [value]);

  const decrypted = encryption?.decrypted;
  useEffect(() => {
    if (decrypted) viewRef.current?.dispatch({ effects: setDecryptedEffect.of(decrypted) });
  }, [decrypted]);

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
