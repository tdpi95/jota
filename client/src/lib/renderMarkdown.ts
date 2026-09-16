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

// An attachment reference (milestone 27, PLAN.md "File attachments") is
// written as a real file-relative link (e.g. "../attachments/notes/foo.png")
// so it stays a working link outside this app too — but that relative path
// means nothing to a browser rendering this HTML into a single-page app with
// no matching route, so it's rewritten to the app's own serving endpoint
// right before rendering. Any other link (a normal http(s) URL, or
// relative-but-not-an-attachment text some content will never actually
// contain) passes through untouched.
const ATTACHMENT_HREF_RE = /^(?:\.\.\/)+attachments\//;

function resolveAttachmentHref(href: string): string {
  return ATTACHMENT_HREF_RE.test(href) ? href.replace(ATTACHMENT_HREF_RE, '/api/attachments/') : href;
}

const defaultImageRule = md.renderer.rules.image ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const srcIndex = token.attrIndex('src');
  const src = srcIndex >= 0 ? token.attrs![srcIndex][1] : undefined;
  const isAttachment = typeof src === 'string' && ATTACHMENT_HREF_RE.test(src);
  if (srcIndex >= 0 && typeof src === 'string') token.attrs![srcIndex][1] = resolveAttachmentHref(src);
  const imageHtml = defaultImageRule(tokens, idx, options, env, self);
  // `![alt](...)` renders as a bare <img> with nothing to click — unlike a
  // plain `[text](...)` link (rewritten by link_open below), an image has
  // no surrounding <a> for markdown-it to ever put a click handler on, so
  // without this it silently did nothing when clicked (an actual bug, not
  // a rendering choice: AttachmentField's own thumbnail chips already wrap
  // every image in a real link, and this should behave the same way). Only
  // wraps an *attachment* image — a normal `![alt](https://...)` embed
  // keeps its previous (unwrapped) behavior.
  if (!isAttachment || srcIndex < 0) return imageHtml;
  const resolvedSrc = md.utils.escapeHtml(String(token.attrs![srcIndex][1]));
  return `<a href="${resolvedSrc}" target="_blank" rel="noopener noreferrer" class="attachment-image-link">${imageHtml}</a>`;
};

const defaultLinkOpenRule = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const hrefIndex = token.attrIndex('href');
  const original = hrefIndex >= 0 ? token.attrs![hrefIndex][1] : undefined;
  if (hrefIndex >= 0 && typeof original === 'string') {
    const resolved = resolveAttachmentHref(original);
    token.attrs![hrefIndex][1] = resolved;
    // Opens in a new tab rather than navigating the SPA away from the note/
    // task it came from — only for links this rewrote, so an ordinary link
    // elsewhere in the body keeps its existing (no-target) behavior.
    if (resolved !== original) token.attrSet('target', '_blank');
  }
  return defaultLinkOpenRule(tokens, idx, options, env, self);
};

export function renderMarkdownToHtml(source: string): string {
  return md.render(source);
}
