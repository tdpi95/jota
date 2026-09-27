import matter from 'gray-matter';

import { HttpError } from '../httpError.js';

// Thin wrapper around gray-matter so callers never import it directly
// (PLAN.md: "gray-matter for all frontmatter") — keeps the YAML library an
// implementation detail isolated to one file.

/** A file whose frontmatter isn't valid YAML — hand-edit typos, or leftover
 * `<<<<<<<` git conflict markers. A 422 rather than a 500: the file is the
 * problem, and the message says how to fix it. */
export class FrontmatterParseError extends HttpError {
  constructor(detail: string) {
    super(
      `This file's frontmatter (the --- block at the top) isn't valid YAML, so it can't be opened: ${detail}. ` +
        'Fix it in a text editor — leftover git conflict markers (<<<<<<<, =======, >>>>>>>) are a common cause.',
      422,
    );
    this.name = 'FrontmatterParseError';
  }
}

export function parseFrontmatter<T extends object>(fileContent: string): { data: T; body: string } {
  let parsed: matter.GrayMatterFile<string>;
  try {
    // Always pass an options object: with none, gray-matter caches by file
    // content and stores the entry *before* parsing — so after the first
    // parse of broken YAML throws, every later call with the same content
    // silently returned the cached half-built result (`data: {}`, the whole
    // file as the body) instead of throwing again. That surfaced as a blank
    // frontmatter in the app, which a save would then have written back.
    parsed = matter(fileContent, {});
  } catch (err) {
    throw new FrontmatterParseError((err as Error).message.split('\n')[0].replace(/:\s*$/, ''));
  }
  return { data: normalizeYamlDates(parsed.data) as T, body: parsed.content };
}

/**
 * js-yaml (which gray-matter uses under the hood) auto-converts an
 * unquoted `YYYY-MM-DD`-shaped scalar into a native JS `Date` per the YAML
 * 1.1 spec — e.g. a hand-edited `created: 2026-09-10` (no quotes), which is
 * exactly how a human would naturally type it. Every date-only field in our
 * frontmatter schemas (`ProjectFrontmatter.created`, `JournalFrontmatter.date`)
 * is declared as a plain `YYYY-MM-DD` string, so recursively coerce any `Date`
 * found in parsed frontmatter back to that shape here — the one place the
 * YAML library's quirks are supposed to be isolated — rather than letting a
 * `Date` leak into services/the SQLite index (which can't bind it) just
 * because a file happened to be saved without quotes.
 *
 * The same YAML timestamp resolution also fires for a full ISO8601
 * datetime scalar (`NoteFrontmatter.created`/`updated`, unquoted) — slicing
 * unconditionally to `YYYY-MM-DD` there would silently drop the time-of-day
 * from a hand-edited note. Only a Date that parsed to exactly UTC midnight
 * is treated as a date-only field and sliced; anything else keeps its full
 * ISO string. (An app-written file never hits this path at all: gray-matter
 * always quotes a string that would otherwise round-trip as a Date, as seen
 * in the `journal-sample.md`/`project-sample.md` fixtures — this only
 * matters for an unquoted value a human typed by hand.)
 */
function normalizeYamlDates(value: unknown): unknown {
  if (value instanceof Date) {
    const iso = value.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
  }
  if (Array.isArray(value)) return value.map(normalizeYamlDates);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, normalizeYamlDates(v)]));
  }
  return value;
}

/** A frontmatter list field (`tags`, `linkedTasks`) as a string array,
 * whatever a hand edit left there: a missing/scalar value becomes `[]`,
 * non-string items are stringified. */
export function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v) => v !== null && v !== undefined).map(String) : [];
}

export function serializeFrontmatter(data: object, body: string): string {
  return matter.stringify(body, data);
}
