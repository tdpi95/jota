import MarkdownIt from 'markdown-it';

import { ENCRYPTED_TOKEN_PREFIX, fullyEncryptedPayload } from './encryptionCrypto';
import { wikilinkHref, type ResolvedLink } from './wikilinks';

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

/** What the preview knows about each encrypted token (milestone 31, PLAN.md
 * "Encryption"), keyed by its payload (the `jota-enc:...` text): its
 * plaintext once decrypted, or 'error' when the session passphrase can't
 * open it. A token missing from the map renders as a locked chip. */
export interface EncryptedPreviewState {
  decrypted: Map<string, string | 'error'>;
  labels: { locked: string; error: string };
}

/** What the preview knows about each `[[wikilink]]` (milestone 32), keyed by
 * its target as written. A target not in the map yet (the lookup is still
 * in flight) renders as plain text; one that resolved to nothing renders as
 * a dangling-link marker. */
export interface WikilinkPreviewState {
  resolved: Map<string, ResolvedLink>;
  labels: { missing: string };
}

type RenderEnv = { encrypted?: EncryptedPreviewState; wikilinks?: WikilinkPreviewState } & Record<string, unknown>;

function lockedChip(state: EncryptedPreviewState | undefined, isError: boolean): string {
  const label = md.utils.escapeHtml(isError ? (state?.labels.error ?? '') : (state?.labels.locked ?? ''));
  return `<span class="enc-inline ${isError ? 'is-error' : 'is-locked'}" data-enc-unlock="1" role="button">🔒 ${label}</span>`;
}

// An encrypted token is an inline code span — rendered decrypted in place
// (its own markdown rendered inline, same env so attachment links behave as
// in plain text), or as a locked chip.
const defaultCodeInlineRule = md.renderer.rules.code_inline ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.code_inline = (tokens, idx, options, env, self) => {
  const content = tokens[idx].content;
  if (!content.startsWith(ENCRYPTED_TOKEN_PREFIX)) return defaultCodeInlineRule(tokens, idx, options, env, self);
  const state = (env as RenderEnv | undefined)?.encrypted;
  const value = state?.decrypted.get(content);
  if (value === undefined || value === 'error') return lockedChip(state, value === 'error');
  return `<span class="enc-inline is-unlocked">${md.renderInline(value, env)}</span>`;
};

// `[[target]]` / `[[target|label]]` (milestone 32). Registered before the
// built-in `link` rule, which would otherwise read `[[x]]` as a link
// reference. Code spans are consumed by the backtick rule before this ever
// sees them, so a link inside code stays literal text.
const WIKILINK_AT_POS_RE = /^\[\[([^\[\]|\n]+?)(?:\|([^\[\]\n]*))?\]\]/;
md.inline.ruler.before('link', 'wikilink', (state, silent) => {
  if (state.src.charCodeAt(state.pos) !== 0x5b || state.src.charCodeAt(state.pos + 1) !== 0x5b) return false;
  const match = WIKILINK_AT_POS_RE.exec(state.src.slice(state.pos));
  if (!match) return false;
  if (!silent) {
    const token = state.push('wikilink', '', 0);
    token.meta = { target: match[1].trim(), label: match[2]?.trim() || null };
  }
  state.pos += match[0].length;
  return true;
});

md.renderer.rules.wikilink = (tokens, idx, _options, env) => {
  const { target, label } = tokens[idx].meta as { target: string; label: string | null };
  const state = (env as RenderEnv | undefined)?.wikilinks;
  const resolved = state?.resolved.get(target);
  // An explicit `|label` wins; otherwise show the target's live title, so a
  // bare `[[t_a1b2c3]]` reads as the task's text rather than its id.
  const text = md.utils.escapeHtml(label ?? resolved?.ref?.title ?? target);
  if (!resolved) return `<span class="wikilink is-pending">${text}</span>`;
  if (!resolved.ref) return `<span class="wikilink is-missing" title="${md.utils.escapeHtml(state?.labels.missing ?? '')}">${text}</span>`;
  const ref = resolved.ref;
  const status = ref.kind === 'task' && ref.status ? `<span class="wikilink-status st-${ref.status}"></span>` : '';
  const done = ref.status === 'done' ? ' is-done' : '';
  const taskId = ref.kind === 'task' ? ` data-task-id="${md.utils.escapeHtml(ref.id)}"` : '';
  return `<a class="wikilink wikilink-${ref.kind}${done}" href="${md.utils.escapeHtml(wikilinkHref(ref))}" data-wikilink="${ref.kind}"${taskId}>${status}${text}</a>`;
};

export function renderMarkdownToHtml(source: string, encrypted?: EncryptedPreviewState, wikilinks?: WikilinkPreviewState): string {
  const env: RenderEnv = { encrypted, wikilinks };
  // A whole note/entry encrypted as one token renders as full block
  // markdown (headings, lists, ...), not squeezed inline.
  const whole = fullyEncryptedPayload(source);
  const plaintext = whole ? encrypted?.decrypted.get(whole) : undefined;
  if (plaintext !== undefined && plaintext !== 'error') return `<div class="enc-whole">${md.render(plaintext, env)}</div>`;
  return md.render(source, env);
}
