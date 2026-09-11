// Project CRUD service (PLAN.md "Backend" + milestone 7) — the one
// implementation both routes/projects.ts and (later) the MCP server call.
// Write path always follows PLAN.md's order: read -> parse -> mutate ->
// serialize -> write file (authoritative) -> upsert index (best-effort) ->
// git commit (best-effort) -> return the in-memory structured form.

import fs from 'node:fs';
import path from 'node:path';

import { HttpError } from '../lib/httpError.js';
import { reconcileWorkspace } from '../lib/index/reindex.js';
import { parseProjectFile, serializeProjectFile, tasksOfProject, type ParsedProjectFile } from '../lib/markdown/project.js';
import { slugify } from '../lib/slug.js';
import { commitChange } from '../lib/vaultGit.js';
import type { ProjectFrontmatter, Task } from '../types.js';

export class ProjectServiceError extends HttpError {
  constructor(message: string, statusCode: number) {
    super(message, statusCode);
    this.name = 'ProjectServiceError';
  }
}

/** Fixed 12-color palette (PLAN.md "Color"): server auto-assigns from this,
 * cycled by creation order, and always writes it to frontmatter — never left
 * to client-side hashing, so every consumer (calendar marks, badges) reads
 * one authoritative field. */
export const COLOR_PALETTE = [
  '#4f86f7',
  '#f7674f',
  '#42c186',
  '#f7a94f',
  '#9b6ff7',
  '#4fc7f7',
  '#f74f9b',
  '#8ac24f',
  '#f7d24f',
  '#6f7bf7',
  '#4ff7d2',
  '#c1424f',
];

export interface ProjectSummary {
  slug: string;
  frontmatter: ProjectFrontmatter;
  tasks: Task[];
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  tags?: string[];
  color?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  tags?: string[];
  color?: string;
  archived?: boolean;
}

function projectsDir(workspacePath: string): string {
  return path.join(workspacePath, 'projects');
}

function projectFilePath(workspacePath: string, slug: string): string {
  return path.join(projectsDir(workspacePath), `${slug}.md`);
}

function projectRelPath(slug: string): string {
  return path.join('projects', `${slug}.md`);
}

function listSlugs(workspacePath: string): string[] {
  const dir = projectsDir(workspacePath);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md') && fs.statSync(path.join(dir, f)).isFile())
    .map((f) => f.slice(0, -'.md'.length));
}

function toSummary(slug: string, parsed: ParsedProjectFile): ProjectSummary {
  return { slug, frontmatter: parsed.frontmatter, tasks: tasksOfProject(parsed) };
}

/** Reads and parses a project file directly from disk — never from the
 * index, per PLAN.md's "which reads go where" (single-project reads are
 * never stale). Exported so services/tasks.ts (a task always lives inside
 * its project's file) reuses the exact same load path rather than
 * duplicating it. */
export function loadProjectFile(workspacePath: string, slug: string): ParsedProjectFile {
  const filePath = projectFilePath(workspacePath, slug);
  if (!fs.existsSync(filePath)) throw new ProjectServiceError(`no project with slug "${slug}"`, 404);
  return parseProjectFile(fs.readFileSync(filePath, 'utf8'));
}

/** Serializes and writes a project file, then best-effort re-indexes and
 * git-commits it. Exported for services/tasks.ts to reuse for task
 * create/update/delete, which mutate the same file. */
export function saveProjectFile(
  workspacePath: string,
  slug: string,
  parsed: ParsedProjectFile,
  origin: string,
  message: string,
): void {
  fs.writeFileSync(projectFilePath(workspacePath, slug), serializeProjectFile(parsed), 'utf8');
  try {
    reconcileWorkspace(workspacePath);
  } catch (err) {
    console.error(`[projects] index reconcile failed for ${workspacePath}:`, (err as Error).message);
  }
  commitChange(workspacePath, { origin, message, paths: [projectRelPath(slug)] });
}

export function listProjects(workspacePath: string): ProjectSummary[] {
  return listSlugs(workspacePath)
    .sort()
    .map((slug) => toSummary(slug, loadProjectFile(workspacePath, slug)));
}

export function getProject(workspacePath: string, slug: string): ProjectSummary {
  return toSummary(slug, loadProjectFile(workspacePath, slug));
}

export function createProject(workspacePath: string, input: CreateProjectInput, origin = 'api'): ProjectSummary {
  const name = input.name?.trim();
  if (!name) throw new ProjectServiceError('name is required', 400);

  const slug = slugify(name);
  if (!slug) throw new ProjectServiceError(`"${input.name}" does not produce a usable slug`, 400);

  const existingSlugs = listSlugs(workspacePath);
  if (existingSlugs.includes(slug)) throw new ProjectServiceError(`a project with slug "${slug}" already exists`, 409);

  const color = input.color ?? COLOR_PALETTE[existingSlugs.length % COLOR_PALETTE.length];
  const frontmatter: ProjectFrontmatter = {
    name,
    created: new Date().toISOString().slice(0, 10),
    archived: false,
    description: input.description ?? '',
    tags: input.tags ?? [],
    color,
  };
  const parsed: ParsedProjectFile = { frontmatter, blocks: [] };

  saveProjectFile(workspacePath, slug, parsed, origin, `create_project ${slug}`);
  return toSummary(slug, parsed);
}

export function updateProject(workspacePath: string, slug: string, input: UpdateProjectInput, origin = 'api'): ProjectSummary {
  const parsed = loadProjectFile(workspacePath, slug);
  if (input.name !== undefined) parsed.frontmatter.name = input.name;
  if (input.description !== undefined) parsed.frontmatter.description = input.description;
  if (input.tags !== undefined) parsed.frontmatter.tags = input.tags;
  if (input.color !== undefined) parsed.frontmatter.color = input.color;
  if (input.archived !== undefined) parsed.frontmatter.archived = input.archived;

  saveProjectFile(workspacePath, slug, parsed, origin, `update_project ${slug}`);
  return toSummary(slug, parsed);
}

export function deleteProject(workspacePath: string, slug: string, origin = 'api'): void {
  const filePath = projectFilePath(workspacePath, slug);
  if (!fs.existsSync(filePath)) throw new ProjectServiceError(`no project with slug "${slug}"`, 404);

  fs.rmSync(filePath);
  try {
    reconcileWorkspace(workspacePath);
  } catch (err) {
    console.error(`[projects] index reconcile failed for ${workspacePath}:`, (err as Error).message);
  }
  commitChange(workspacePath, { origin, message: `delete_project ${slug}`, paths: [projectRelPath(slug)] });
}
