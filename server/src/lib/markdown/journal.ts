import type { JournalFrontmatter } from '../../types.js';
import { parseFrontmatter, serializeFrontmatter, stringArray } from './frontmatter.js';

export interface ParsedJournalFile {
  frontmatter: JournalFrontmatter;
  /** Freeform markdown body, unparsed. */
  body: string;
}

export function parseJournalFile(fileContent: string): ParsedJournalFile {
  const { data, body } = parseFrontmatter<Partial<Record<keyof JournalFrontmatter, unknown>>>(fileContent);
  // Same wrong-shape coercion as note.ts. `date` is left as-is: services
  // always know the date from the filename.
  const frontmatter = { ...data, tags: stringArray(data.tags), linkedTasks: stringArray(data.linkedTasks) } as JournalFrontmatter;
  return { frontmatter, body };
}

export function serializeJournalFile(parsed: ParsedJournalFile): string {
  return serializeFrontmatter(parsed.frontmatter, parsed.body);
}
