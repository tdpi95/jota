import { useEffect, useRef } from 'react';
import { Annotation, Compartment, EditorState, RangeSetBuilder } from '@codemirror/state';
import { Decoration, drawSelection, dropCursor, EditorView, keymap, placeholder as placeholderExt, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { tags as t } from '@lezer/highlight';

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
}

/**
 * A CodeMirror 6-backed replacement for the plain `<textarea>` journal body
 * used to use (see MarkdownTextarea.tsx, still used as-is for task/project
 * descriptions) — same controlled-value contract, but with markdown syntax
 * highlighting live as you type. Deliberately *not* a rendered/WYSIWYG
 * preview: the stored value is still the raw markdown text untouched, this
 * only changes how it's colored on screen.
 */
export default function MarkdownEditor({ value, onChange, placeholder, disabled, className }: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const editableCompartment = useRef(new Compartment()).current;

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
          keymap.of([...defaultKeymap, ...historyKeymap]),
          // No `codeLanguages` — that pulls in a lazy chunk per possible
          // fence info-string language (pug, nginx, verilog, ...) just to
          // syntax-color code *inside* fences, well past what "highlight
          // the markdown, VS Code-style" asked for. Fenced code still gets
          // the flat --md-code monospace look via tags.monospace below.
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(markdownHighlightStyle),
          codeBlockBackground,
          inlineCodeBackground,
          placeholderExt(placeholder ?? ''),
          editableCompartment.of([EditorView.editable.of(!disabled), EditorState.readOnly.of(!!disabled)]),
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

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: editableCompartment.reconfigure([EditorView.editable.of(!disabled), EditorState.readOnly.of(!!disabled)]),
    });
  }, [disabled, editableCompartment]);

  const classes = ['md-editor', className, disabled ? 'is-disabled' : ''].filter(Boolean).join(' ');
  return <div ref={containerRef} className={classes} />;
}
