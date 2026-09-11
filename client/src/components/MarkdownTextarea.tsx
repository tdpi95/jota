import type { TextareaHTMLAttributes } from 'react';

/**
 * A plain freeform-text textarea — journal bodies and task descriptions are
 * both unparsed/lightly-parsed markdown stored verbatim (PLAN.md: journal
 * body is "Freeform markdown body, unparsed"; task description is
 * indented-continuation-line free text). No markdown rendering/preview is
 * part of v1 — this is a thin styled wrapper so both call sites share one
 * look, not a rich editor.
 */
export default function MarkdownTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className, ...rest } = props;
  return <textarea className={className ? `md-textarea ${className}` : 'md-textarea'} {...rest} />;
}
