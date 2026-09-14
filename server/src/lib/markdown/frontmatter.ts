import matter from 'gray-matter';

// Thin wrapper around gray-matter so callers never import it directly
// (PLAN.md: "gray-matter for all frontmatter") — keeps the YAML library an
// implementation detail isolated to one file.

export function parseFrontmatter<T extends object>(fileContent: string): { data: T; body: string } {
  const parsed = matter(fileContent);
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

export function serializeFrontmatter(data: object, body: string): string {
  return matter.stringify(body, data);
}
