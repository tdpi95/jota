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

/** A scalar frontmatter value as a string: a hand edit can leave a number
 * (`name: 2026`), a list, or nothing at all where a string belongs. */
function scalarString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/**
 * Valid YAML can still be missing fields or have the wrong shape after a hand
 * edit — a project file typed from scratch rarely has `created`/`archived`/
 * `description`, and may have no frontmatter at all. Coerce every field to
 * the shape `ProjectFrontmatter` promises (same idea as note.ts) rather than
 * letting `undefined` reach services, the client, or the SQLite index, where
 * binding it aborted reconciliation for the whole workspace. A missing
 * `created` stays `''` rather than inventing a date; a missing `name` falls
 * back to `slug` when the caller knows it (it comes from the filename, see
 * PLAN.md). Spread first so existing keys keep their order — a complete file
 * still round-trips byte-for-byte; a sparse one gains the missing keys the
 * next time the app writes it, same as `group` always has.
 */
export function parseProjectFile(fileContent: string, slug?: string): ParsedProjectFile {
  const { data, body } = parseFrontmatter<Partial<Record<keyof ProjectFrontmatter, unknown>>>(fileContent);
  const frontmatter = {
    ...data,
    name: scalarString(data.name).trim() ? scalarString(data.name) : (slug ?? ''),
    created: scalarString(data.created),
    archived: data.archived === true,
    description: scalarString(data.description),
    group: scalarString(data.group).trim() || DEFAULT_GROUP,
    color: scalarString(data.color),
  } as ProjectFrontmatter;
  if (typeof data.profileImage !== 'string') delete frontmatter.profileImage;
  return { frontmatter, blocks: parseProjectBody(body) };
}

export function serializeProjectFile(parsed: ParsedProjectFile): string {
  return serializeFrontmatter(parsed.frontmatter, serializeProjectBody(parsed.blocks));
}

export function tasksOfProject(parsed: ParsedProjectFile): Task[] {
  return tasksOf(parsed.blocks);
}
