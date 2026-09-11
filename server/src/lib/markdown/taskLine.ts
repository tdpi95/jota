import type { Task, TaskStatus } from '../../types.js';

// The task-line grammar: everything else (services, MCP tools, UI) depends on
// this being exactly right. See PLAN.md's "Storage format" section for the
// grammar spec. On write, tokens are always re-emitted in this fixed order:
//
//   @due(YYYY-MM-DD) -> @created(ISO8601 UTC) -> @doingSince(ISO8601 UTC)
//     -> @spent(XhYm) -> @done(YYYY-MM-DD) -> #tag(s) -> <!-- id:t_xxxxxx -->
//
// On read, tokens are accepted in any order/whitespace — the regex below
// matches each token type regardless of position in the line.

const CHECKBOX_RE = /^- \[( |x|\/)\] (.*)$/;

/** Matches one recognized inline token; alternation groups line up 1:1 with
 * the `groups` destructure in parseTaskTokens below. */
const TOKEN_RE =
  /@due\(([^)]*)\)|@created\(([^)]*)\)|@doingSince\(([^)]*)\)|@spent\(([^)]*)\)|@done\(([^)]*)\)|#([^\s#()]+)|<!--\s*id:(\S+?)\s*-->/g;

/** A parsed project body is a sequence of blocks: recognized tasks, and raw
 * content (anything else) preserved verbatim so the parser never silently
 * drops content it doesn't understand — see PLAN.md's "non-destructive to
 * content it doesn't understand" requirement. */
export type ProjectBodyBlock = { type: 'task'; task: Task } | { type: 'raw'; text: string };

/** Compact human duration, e.g. "2h15m", "45m", "3h". Empty minutes -> "". */
export function formatDuration(totalMinutes: number): string {
  if (totalMinutes <= 0) return '';
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0 && m > 0) return `${h}h${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export function parseDuration(raw: string): number {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?$/.exec(raw.trim());
  if (!m || (!m[1] && !m[2])) {
    throw new Error(`Invalid @spent duration: "${raw}"`);
  }
  const hours = m[1] ? parseInt(m[1], 10) : 0;
  const minutes = m[2] ? parseInt(m[2], 10) : 0;
  return hours * 60 + minutes;
}

interface ParsedTokens {
  text: string;
  due: string | null;
  created: string;
  doingSince: string | null;
  spentMinutes: number;
  doneAt: string | null;
  tags: string[];
  id: string;
}

function parseTaskTokens(rest: string): ParsedTokens {
  let due: string | null = null;
  let created: string | null = null;
  let doingSince: string | null = null;
  let spentMinutes = 0;
  let doneAt: string | null = null;
  const tags: string[] = [];
  let id: string | null = null;

  const text = rest
    .replace(TOKEN_RE, (_m, dueM, createdM, doingSinceM, spentM, doneM, tagM, idM) => {
      if (dueM !== undefined) due = dueM;
      else if (createdM !== undefined) created = createdM;
      else if (doingSinceM !== undefined) doingSince = doingSinceM;
      else if (spentM !== undefined) spentMinutes = parseDuration(spentM);
      else if (doneM !== undefined) doneAt = doneM;
      else if (tagM !== undefined) tags.push(tagM);
      else if (idM !== undefined) id = idM;
      return '';
    })
    .replace(/[ \t]+/g, ' ')
    .trim();

  if (!created) throw new Error(`Task line missing required @created(...) token: "${rest}"`);
  if (!id) throw new Error(`Task line missing required <!-- id:... --> token: "${rest}"`);

  return { text, due, created, doingSince, spentMinutes, doneAt, tags, id };
}

/** Serializes one task to its checkbox line + indented description lines
 * (if any), joined with '\n'. Does not include a trailing newline. */
export function serializeTask(task: Task): string {
  const marker = task.status === 'done' ? 'x' : task.status === 'doing' ? '/' : ' ';

  const tokens: string[] = [];
  if (task.due) tokens.push(`@due(${task.due})`);
  tokens.push(`@created(${task.created})`);
  if (task.doingSince) tokens.push(`@doingSince(${task.doingSince})`);
  if (task.spentMinutes > 0) tokens.push(`@spent(${formatDuration(task.spentMinutes)})`);
  if (task.doneAt) tokens.push(`@done(${task.doneAt})`);
  for (const tag of task.tags) tokens.push(`#${tag}`);
  tokens.push(`<!-- id:${task.id} -->`);

  const line = `- [${marker}] ${task.text} ${tokens.join(' ')}`;
  if (!task.description) return line;

  const descLines = task.description.split('\n').map((l) => (l === '' ? '' : `  ${l}`));
  return [line, ...descLines].join('\n');
}

/** Parses a project file's body (frontmatter already stripped) into an
 * ordered sequence of task/raw blocks. */
export function parseProjectBody(body: string): ProjectBodyBlock[] {
  const lines = body.split('\n');
  const blocks: ProjectBodyBlock[] = [];
  let raw: string[] = [];
  let i = 0;

  const flushRaw = () => {
    if (raw.length > 0) {
      blocks.push({ type: 'raw', text: raw.join('\n') });
      raw = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    const m = CHECKBOX_RE.exec(line);
    if (!m) {
      raw.push(line);
      i++;
      continue;
    }
    flushRaw();

    const status: TaskStatus = m[1] === 'x' ? 'done' : m[1] === '/' ? 'doing' : 'todo';
    const tokens = parseTaskTokens(m[2]);
    i++;

    // Description: indented (2-space) continuation lines. A run of blank
    // lines only belongs to the description if a further indented line
    // follows it (i.e. it's a paragraph break, not the end of the block).
    const descLines: string[] = [];
    while (i < lines.length) {
      const l = lines[i];
      if (l === '') {
        let j = i;
        while (j < lines.length && lines[j] === '') j++;
        if (j < lines.length && /^ {2}/.test(lines[j])) {
          for (let k = i; k < j; k++) descLines.push('');
          i = j;
          continue;
        }
        break;
      }
      if (/^ {2}/.test(l)) {
        descLines.push(l.slice(2));
        i++;
        continue;
      }
      break;
    }
    while (descLines.length > 0 && descLines[descLines.length - 1] === '') descLines.pop();
    const description = descLines.length > 0 ? descLines.join('\n') : null;

    blocks.push({
      type: 'task',
      task: {
        id: tokens.id,
        status,
        text: tokens.text,
        due: tokens.due,
        created: tokens.created,
        doingSince: tokens.doingSince,
        spentMinutes: tokens.spentMinutes,
        doneAt: tokens.doneAt,
        tags: tokens.tags,
        description,
      },
    });
  }
  flushRaw();
  return blocks;
}

export function serializeProjectBody(blocks: ProjectBodyBlock[]): string {
  return blocks.map((b) => (b.type === 'raw' ? b.text : serializeTask(b.task))).join('\n');
}

export function tasksOf(blocks: ProjectBodyBlock[]): Task[] {
  return blocks.filter((b): b is { type: 'task'; task: Task } => b.type === 'task').map((b) => b.task);
}
