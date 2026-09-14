import MarkdownIt from 'markdown-it';

// Backs NoteDetailPage's edit/preview toggle — the one place in this app
// that renders markdown to actual HTML rather than just syntax-coloring it
// (contrast MarkdownEditor.tsx, which deliberately never does, per PLAN.md
// "Journal editor": that was a considered choice for the journal body, kept
// unchanged there; notes get their own separate preview mode instead of
// reopening that decision).
//
// `html: false` is deliberate, not just the default left unstated: unlike
// the CodeMirror editor, this output goes straight into
// `dangerouslySetInnerHTML`, and a note body is effectively untrusted input
// — freely writable by an MCP agent (PLAN.md "Agent access via MCP" grants
// full read+write) or by an external sync tool editing the file directly.
// With `html: false`, any raw `<tag>` in the source is escaped as literal
// text instead of being parsed and injected, so this needs no separate HTML
// sanitizer. `linkify: true` auto-links bare URLs, matching the GFM dialect
// MarkdownEditor already highlights against (tables/strikethrough are on by
// default in markdown-it's standard preset).
const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

export function renderMarkdownToHtml(source: string): string {
  return md.render(source);
}
