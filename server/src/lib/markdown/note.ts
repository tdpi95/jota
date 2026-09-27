import type { NoteFrontmatter } from '../../types.js';
import { parseFrontmatter, serializeFrontmatter, stringArray } from './frontmatter.js';

export interface ParsedNoteFile {
  frontmatter: NoteFrontmatter;
  /** Freeform markdown body, unparsed — same convention as journal entries. */
  body: string;
}

export function parseNoteFile(fileContent: string): ParsedNoteFile {
  const { data, body } = parseFrontmatter<Partial<Record<keyof NoteFrontmatter, unknown>>>(fileContent);
  // Valid YAML can still have the wrong shape after a hand edit (`tags: foo`,
  // no `title`) — coerce rather than hand the client something it'd crash on.
  // Spread first so existing keys keep their order (round-trip stays exact).
  const frontmatter: NoteFrontmatter = {
    ...data,
    title: typeof data.title === 'string' ? data.title : String(data.title ?? ''),
    created: typeof data.created === 'string' ? data.created : String(data.created ?? ''),
    updated: typeof data.updated === 'string' ? data.updated : String(data.updated ?? ''),
    tags: stringArray(data.tags),
  };
  return { frontmatter, body };
}

export function serializeNoteFile(parsed: ParsedNoteFile): string {
  return serializeFrontmatter(parsed.frontmatter, parsed.body);
}
