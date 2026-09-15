import type { ProjectFrontmatter, Task } from '../../types.js';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.js';
import { parseProjectBody, serializeProjectBody, tasksOf, type ProjectBodyBlock } from './taskLine.js';

/** Fallback group for a project with none set — a brand-new project whose
 * form was left blank, or a hand-edited/pre-existing file with no `group`
 * field in frontmatter at all (see PLAN.md "Project file"). */
export const DEFAULT_GROUP = 'Default';

export interface ParsedProjectFile {
  frontmatter: ProjectFrontmatter;
  /** Ordered task/raw blocks — the source of truth for serialization.
   * Slug is not part of this: it comes from the filename (see PLAN.md). */
  blocks: ProjectBodyBlock[];
}

export function parseProjectFile(fileContent: string): ParsedProjectFile {
  const { data, body } = parseFrontmatter<ProjectFrontmatter>(fileContent);
  data.group = data.group?.trim() || DEFAULT_GROUP;
  return { frontmatter: data, blocks: parseProjectBody(body) };
}

export function serializeProjectFile(parsed: ParsedProjectFile): string {
  return serializeFrontmatter(parsed.frontmatter, serializeProjectBody(parsed.blocks));
}

export function tasksOfProject(parsed: ParsedProjectFile): Task[] {
  return tasksOf(parsed.blocks);
}
