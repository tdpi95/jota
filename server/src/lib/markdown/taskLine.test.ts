import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseProjectFile, serializeProjectFile, tasksOfProject } from './project.js';
import { parseJournalFile, serializeJournalFile } from './journal.js';
import { formatDuration, parseDuration, serializeTask } from './taskLine.js';
import type { Task } from '../../types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(path.join(here, '__fixtures__', name), 'utf8');

test('project file round-trips byte-for-byte (parse -> serialize)', () => {
  const original = fixture('project-sample.md');
  const parsed = parseProjectFile(original);
  const reserialized = serializeProjectFile(parsed);
  assert.strictEqual(reserialized, original);
});

test('project file parses frontmatter and every task field', () => {
  const parsed = parseProjectFile(fixture('project-sample.md'));

  assert.deepEqual(parsed.frontmatter, {
    name: 'Website Redesign',
    created: '2026-09-10',
    archived: false,
    description: 'Full redesign of the marketing site, launching alongside the Q4 product announcement.',
    tags: ['marketing', 'q4'],
    color: '#4f86f7',
  });

  const tasks = tasksOfProject(parsed);
  assert.equal(tasks.length, 3);

  const [doing, done, todo] = tasks;
  assert.deepEqual(doing, {
    id: 't_9f0e21',
    status: 'doing',
    text: 'Draft new homepage copy',
    due: '2026-09-20',
    created: '2026-09-08T09:15:00Z',
    doingSince: '2026-09-10T13:00:00Z',
    spentMinutes: 135,
    doneAt: null,
    tags: ['content'],
    description:
      'Marketing wants a warmer tone than the old site. Pull inspiration from\nthe Q3 brand deck before writing final copy.\n\nCheck with Linh about the hero image licensing before this goes live.',
    checklist: [
      { done: true, text: 'Get sign-off on tone from marketing' },
      { done: false, text: 'Write final copy' },
    ],
  });
  assert.deepEqual(done, {
    id: 't_1122aa',
    status: 'done',
    text: 'Buy domain name',
    due: '2026-08-01',
    created: '2026-07-20T10:00:00Z',
    doingSince: null,
    spentMinutes: 0,
    doneAt: '2026-08-01',
    tags: [],
    description: null,
    checklist: [],
  });
  assert.deepEqual(todo, {
    id: 't_a1b2c3',
    status: 'todo',
    text: 'Write launch announcement blog post',
    due: null,
    created: '2026-09-11T08:00:00Z',
    doingSince: null,
    spentMinutes: 0,
    doneAt: null,
    tags: ['content', 'high'],
    description: null,
    checklist: [],
  });

  // Raw content ("## Backlog" heading) is preserved, not dropped.
  assert.ok(parsed.blocks.some((b) => b.type === 'raw' && b.text.includes('## Backlog')));
});

test('journal file round-trips byte-for-byte (parse -> serialize)', () => {
  const original = fixture('journal-sample.md');
  const parsed = parseJournalFile(original);
  const reserialized = serializeJournalFile(parsed);
  assert.strictEqual(reserialized, original);
});

test('journal file parses frontmatter and body', () => {
  const parsed = parseJournalFile(fixture('journal-sample.md'));
  assert.deepEqual(parsed.frontmatter, {
    date: '2026-09-10',
    tags: ['retro'],
    linkedTasks: ['t_a1b2c3', 't_9f0e21'],
  });
  assert.equal(
    parsed.body,
    'Spent most of the day on homepage copy. Feeling good about the direction.\n\nNeed to follow up with Linh about licensing tomorrow.\n',
  );
});

test('task tokens parse in any order on read', () => {
  const blocks = parseProjectFileBody(
    '- [ ] Some task #tag1 <!-- id:t_abc123 --> @created(2026-01-01T00:00:00Z) @due(2026-02-01) #tag2',
  );
  const taskBlocks = blocks.filter((b) => b.type === 'task');
  assert.equal(taskBlocks.length, 1);
  const task = taskBlocks[0].type === 'task' ? taskBlocks[0].task : null;
  assert.ok(task);
  assert.equal(task!.text, 'Some task');
  assert.equal(task!.due, '2026-02-01');
  assert.equal(task!.created, '2026-01-01T00:00:00Z');
  assert.deepEqual(task!.tags, ['tag1', 'tag2']);
  assert.equal(task!.id, 't_abc123');
});

test('missing required tokens throw a clear error', () => {
  assert.throws(() => parseProjectFileBody('- [ ] No id or created token'), /missing required @created/);
  assert.throws(
    () => parseProjectFileBody('- [ ] Has created @created(2026-01-01T00:00:00Z)'),
    /missing required <!-- id/,
  );
});

test('formatDuration / parseDuration round-trip compact durations', () => {
  assert.equal(formatDuration(0), '');
  assert.equal(formatDuration(45), '45m');
  assert.equal(formatDuration(180), '3h');
  assert.equal(formatDuration(135), '2h15m');
  assert.equal(parseDuration('45m'), 45);
  assert.equal(parseDuration('3h'), 180);
  assert.equal(parseDuration('2h15m'), 135);
  assert.throws(() => parseDuration('nonsense'), /Invalid @spent duration/);
});

test('formatDuration / parseDuration round-trip days (a day is a flat 24h)', () => {
  assert.equal(formatDuration(1440), '1d');
  assert.equal(formatDuration(1500), '1d1h');
  assert.equal(formatDuration(1445), '1d5m');
  assert.equal(formatDuration(1500 + 15), '1d1h15m');
  assert.equal(formatDuration(3 * 1440), '3d');
  assert.equal(parseDuration('1d'), 1440);
  assert.equal(parseDuration('1d1h'), 1500);
  assert.equal(parseDuration('1d5m'), 1445);
  assert.equal(parseDuration('1d1h15m'), 1515);
  assert.equal(parseDuration('3d'), 3 * 1440);
});

test('serializeTask always re-emits tokens in the fixed order', () => {
  const task: Task = {
    id: 't_zzzzzz',
    status: 'doing',
    text: 'Reordered input',
    due: '2026-03-01',
    created: '2026-01-01T00:00:00Z',
    doingSince: '2026-01-02T00:00:00Z',
    spentMinutes: 60,
    doneAt: null,
    tags: ['a', 'b'],
    description: null,
    checklist: [],
  };
  assert.equal(
    serializeTask(task),
    '- [/] Reordered input @due(2026-03-01) @created(2026-01-01T00:00:00Z) @doingSince(2026-01-02T00:00:00Z) @spent(1h) #a #b <!-- id:t_zzzzzz -->',
  );
});

test('serializeTask writes checklist items right after the checkbox line, before the description', () => {
  const task: Task = {
    id: 't_check1',
    status: 'todo',
    text: 'Ship the feature',
    due: null,
    created: '2026-01-01T00:00:00Z',
    doingSince: null,
    spentMinutes: 0,
    doneAt: null,
    tags: [],
    description: 'Some notes.',
    checklist: [
      { done: true, text: 'Write the code' },
      { done: false, text: 'Write the tests' },
    ],
  };
  assert.equal(
    serializeTask(task),
    '- [ ] Ship the feature @created(2026-01-01T00:00:00Z) <!-- id:t_check1 -->\n' +
      '  - [x] Write the code\n' +
      '  - [ ] Write the tests\n' +
      '  Some notes.',
  );
});

test('checklist round-trips through parse -> serialize and coexists with a description', () => {
  const original = serializeTask({
    id: 't_check2',
    status: 'todo',
    text: 'Ship the feature',
    due: null,
    created: '2026-01-01T00:00:00Z',
    doingSince: null,
    spentMinutes: 0,
    doneAt: null,
    tags: [],
    description: 'Line one.\n\nLine two.',
    checklist: [
      { done: true, text: 'Write the code' },
      { done: false, text: 'Write the tests' },
    ],
  });
  const blocks = parseProjectFileBody(original);
  const task = blocks[0].type === 'task' ? blocks[0].task : null;
  assert.ok(task);
  assert.deepEqual(task!.checklist, [
    { done: true, text: 'Write the code' },
    { done: false, text: 'Write the tests' },
  ]);
  assert.equal(task!.description, 'Line one.\n\nLine two.');
  assert.equal(serializeTask(task!), original);
});

test('a task with no checklist parses it as an empty array', () => {
  const blocks = parseProjectFileBody('- [ ] No sub-tasks here @created(2026-01-01T00:00:00Z) <!-- id:t_nosub -->');
  const task = blocks[0].type === 'task' ? blocks[0].task : null;
  assert.ok(task);
  assert.deepEqual(task!.checklist, []);
});

// Small local helper so the "any order" / "missing token" tests above don't
// need a full project file (frontmatter + body) just to exercise the line
// grammar.
function parseProjectFileBody(line: string) {
  const wrapped = `---\nname: x\ncreated: '2026-01-01'\narchived: false\ndescription: ''\ntags: []\ncolor: '#000000'\n---\n${line}\n`;
  return parseProjectFile(wrapped).blocks;
}
