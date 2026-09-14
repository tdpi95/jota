import type { NoteFrontmatter } from '../../types.js';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.js';

export interface ParsedNoteFile {
  frontmatter: NoteFrontmatter;
  /** Freeform markdown body, unparsed — same convention as journal entries. */
  body: string;
}

export function parseNoteFile(fileContent: string): ParsedNoteFile {
  const { data, body } = parseFrontmatter<NoteFrontmatter>(fileContent);
  return { frontmatter: data, body };
}

export function serializeNoteFile(parsed: ParsedNoteFile): string {
  return serializeFrontmatter(parsed.frontmatter, parsed.body);
}
