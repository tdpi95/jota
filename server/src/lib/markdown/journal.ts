import type { JournalFrontmatter } from '../../types.js';
import { appendLinkedTasksBlock, stripLinkedTasksBlock } from './linkedTasksBlock.js';
import { parseFrontmatter, serializeFrontmatter, stringArray } from './frontmatter.js';

export interface ParsedJournalFile {
  frontmatter: JournalFrontmatter;
  /** Freeform markdown body, unparsed — minus the generated linked-tasks block. */
  body: string;
}

export function parseJournalFile(fileContent: string): ParsedJournalFile {
  const { data, body } = parseFrontmatter<Partial<Record<keyof JournalFrontmatter, unknown>>>(fileContent);
  // Same wrong-shape coercion as note.ts. `date` is left as-is: services
  // always know the date from the filename.
  const frontmatter = { ...data, tags: stringArray(data.tags), linkedTasks: stringArray(data.linkedTasks) } as JournalFrontmatter;
  return { frontmatter, body: stripLinkedTasksBlock(body) };
}

/** `linkedTitles` (one per `linkedTasks` id, same order) adds the generated
 * "Linked tasks" block; omit it and the file is written without one. */
export function serializeJournalFile(parsed: ParsedJournalFile, linkedTitles: string[] = []): string {
  return serializeFrontmatter(parsed.frontmatter, appendLinkedTasksBlock(parsed.body, linkedTitles));
}
