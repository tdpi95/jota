import matter from 'gray-matter';

// Thin wrapper around gray-matter so callers never import it directly
// (PLAN.md: "gray-matter for all frontmatter") — keeps the YAML library an
// implementation detail isolated to one file.

export function parseFrontmatter<T extends object>(fileContent: string): { data: T; body: string } {
  const parsed = matter(fileContent);
  return { data: parsed.data as T, body: parsed.content };
}

export function serializeFrontmatter(data: object, body: string): string {
  return matter.stringify(body, data);
}
