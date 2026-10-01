// The generated "Linked tasks" block at the end of a journal body. It's a
// human-readable mirror of the frontmatter `linkedTasks` ids (titles only,
// no status — that would go stale the moment a task changes outside the app)
// so the file reads sensibly in any other markdown viewer. `linkedTasks`
// stays the source of truth: the block is stripped on parse, regenerated on
// serialize, and never read back, so a hand edit to it is simply overwritten.

const START = '<!-- jota:linked-tasks -->';
const END = '<!-- /jota:linked-tasks -->';
const BLOCK_RE = /\n*<!-- jota:linked-tasks -->[\s\S]*?<!-- \/jota:linked-tasks -->[ \t]*\n*/;

export function stripLinkedTasksBlock(body: string): string {
  return body.replace(BLOCK_RE, '');
}

/** `titles` are in `linkedTasks` order; no titles → no block. */
export function appendLinkedTasksBlock(body: string, titles: string[]): string {
  if (titles.length === 0) return body;
  const items = titles.map((title) => `- ${title.replace(/\s+/g, ' ').trim()}`).join('\n');
  const block = `${START}\n## Linked tasks\n\n${items}\n${END}\n`;
  const trimmed = body.replace(/\n+$/, '');
  return trimmed ? `${trimmed}\n\n${block}` : block;
}
