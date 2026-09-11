import type { JournalFrontmatter } from '../../types.js';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.js';

export interface ParsedJournalFile {
  frontmatter: JournalFrontmatter;
  /** Freeform markdown body, unparsed. */
  body: string;
}

export function parseJournalFile(fileContent: string): ParsedJournalFile {
  const { data, body } = parseFrontmatter<JournalFrontmatter>(fileContent);
  return { frontmatter: data, body };
}

export function serializeJournalFile(parsed: ParsedJournalFile): string {
  return serializeFrontmatter(parsed.frontmatter, parsed.body);
}
