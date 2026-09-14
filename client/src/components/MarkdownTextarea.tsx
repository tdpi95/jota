import type { TextareaHTMLAttributes } from 'react';

/**
 * A plain freeform-text textarea — used for task and project descriptions,
 * both unparsed/lightly-parsed markdown stored verbatim (PLAN.md: task
 * description is indented-continuation-line free text). No syntax
 * highlighting here; this is a thin styled wrapper so both call sites share
 * one look, not a rich editor. The journal body uses MarkdownEditor.tsx
 * instead (CodeMirror-backed, VS Code-style markdown syntax highlighting) —
 * see PLAN.md's "Journal editor" for why the split isn't extended here too.
 */
export default function MarkdownTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className, ...rest } = props;
  return <textarea className={className ? `md-textarea ${className}` : 'md-textarea'} {...rest} />;
}
