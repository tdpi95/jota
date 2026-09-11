import type { ProjectFrontmatter, Task } from '../../types.js';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.js';
import { parseProjectBody, serializeProjectBody, tasksOf, type ProjectBodyBlock } from './taskLine.js';

export interface ParsedProjectFile {
  frontmatter: ProjectFrontmatter;
  /** Ordered task/raw blocks — the source of truth for serialization.
   * Slug is not part of this: it comes from the filename (see PLAN.md). */
  blocks: ProjectBodyBlock[];
}

export function parseProjectFile(fileContent: string): ParsedProjectFile {
  const { data, body } = parseFrontmatter<ProjectFrontmatter>(fileContent);
  return { frontmatter: data, blocks: parseProjectBody(body) };
}

export function serializeProjectFile(parsed: ParsedProjectFile): string {
  return serializeFrontmatter(parsed.frontmatter, serializeProjectBody(parsed.blocks));
}

export function tasksOfProject(parsed: ParsedProjectFile): Task[] {
  return tasksOf(parsed.blocks);
}
