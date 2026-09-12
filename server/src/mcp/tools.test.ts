import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { getHistory, revertCommit } from '../lib/vaultGit.js';
import { ensureGitRepo } from '../lib/workspaces.js';
import { registerTools } from './tools.js';

// Exercises the MCP server through a real MCP client (an in-process SDK
// Client over InMemoryTransport, not curl) — mirrors PLAN.md milestone 10's
// verify step: create/update via tool calls, confirm files/git history match
// what the REST API would have produced, and that a revert cleanly undoes
// an agent-made change.

function scratchWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poco-mcp-'));
  fs.mkdirSync(path.join(dir, 'projects'), { recursive: true });
  ensureGitRepo(dir);
  return dir;
}

async function connectedClient(workspacePath: string): Promise<Client> {
  const server = new McpServer({ name: 'poco-test', version: '0.0.0' });
  registerTools(server, workspacePath);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

function expectOk<T>(result: CallToolResult): T {
  assert.notEqual(result.isError, true, `expected a successful tool result, got: ${JSON.stringify(result.content)}`);
  const [first] = result.content;
  assert.ok(first && first.type === 'text');
  return JSON.parse(first.text) as T;
}

function expectError(result: CallToolResult): string {
  assert.equal(result.isError, true);
  const [first] = result.content;
  assert.ok(first && first.type === 'text');
  return first.text;
}

test('the tool list matches PLAN.md\'s MCP tool set', async () => {
  const client = await connectedClient(scratchWorkspace());
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    [
      'create_project',
      'create_task',
      'delete_task',
      'get_journal_entry',
      'get_project',
      'get_task_summary',
      'link_task_to_journal',
      'list_open_tasks',
      'list_projects',
      'search_tasks',
      'unlink_task_from_journal',
      'update_project',
      'update_task',
      'upsert_journal_entry',
    ].sort(),
  );
});

test('create_project and create_task write real files, index, and commit as [mcp:<tool>]', async () => {
  const ws = scratchWorkspace();
  const client = await connectedClient(ws);

  const project = expectOk<{ slug: string; frontmatter: { color: string } }>(
    await client.callTool({ name: 'create_project', arguments: { name: 'Website Redesign' } }) as CallToolResult,
  );
  assert.equal(project.slug, 'website-redesign');

  const task = expectOk<{ id: string; status: string }>(
    await client.callTool({
      name: 'create_task',
      arguments: { projectSlug: 'website-redesign', text: 'Draft homepage copy', tags: ['content'] },
    }) as CallToolResult,
  );
  assert.equal(task.status, 'todo');

  const onDisk = fs.readFileSync(path.join(ws, 'projects', 'website-redesign.md'), 'utf8');
  assert.match(onDisk, new RegExp(`id:${task.id}`));

  const history = getHistory(ws);
  assert.equal(history[0].message, `[mcp:create_task] create_task ${task.id} (website-redesign)`);
  assert.equal(history[1].message, '[mcp:create_project] create_project website-redesign');
});

test('update_task drives the doing-timer transition exactly as the REST API would', async () => {
  const ws = scratchWorkspace();
  const client = await connectedClient(ws);
  await client.callTool({ name: 'create_project', arguments: { name: 'Website Redesign' } });
  const task = expectOk<{ id: string }>(
    (await client.callTool({
      name: 'create_task',
      arguments: { projectSlug: 'website-redesign', text: 'Draft homepage copy' },
    })) as CallToolResult,
  );

  const doing = expectOk<{ status: string; doingSince: string | null }>(
    (await client.callTool({
      name: 'update_task',
      arguments: { projectSlug: 'website-redesign', taskId: task.id, status: 'doing' },
    })) as CallToolResult,
  );
  assert.equal(doing.status, 'doing');
  assert.ok(doing.doingSince);

  const onDisk = fs.readFileSync(path.join(ws, 'projects', 'website-redesign.md'), 'utf8');
  assert.match(onDisk, /@doingSince\(/);
  assert.equal(getHistory(ws)[0].message, `[mcp:update_task] update_task ${task.id} status todo→doing (website-redesign)`);
});

test('create_task/update_task pass checklist items through to the file and back', async () => {
  const ws = scratchWorkspace();
  const client = await connectedClient(ws);
  await client.callTool({ name: 'create_project', arguments: { name: 'Website Redesign' } });

  const task = expectOk<{ id: string; checklist: { text: string; done: boolean }[] }>(
    (await client.callTool({
      name: 'create_task',
      arguments: {
        projectSlug: 'website-redesign',
        text: 'Draft homepage copy',
        checklist: [{ text: 'Get sign-off', done: false }],
      },
    })) as CallToolResult,
  );
  assert.deepEqual(task.checklist, [{ text: 'Get sign-off', done: false }]);

  const onDisk = fs.readFileSync(path.join(ws, 'projects', 'website-redesign.md'), 'utf8');
  assert.match(onDisk, /- \[ \] Get sign-off/);

  const updated = expectOk<{ checklist: { text: string; done: boolean }[] }>(
    (await client.callTool({
      name: 'update_task',
      arguments: {
        projectSlug: 'website-redesign',
        taskId: task.id,
        checklist: [
          { text: 'Get sign-off', done: true },
          { text: 'Write final copy', done: false },
        ],
      },
    })) as CallToolResult,
  );
  assert.deepEqual(updated.checklist, [
    { text: 'Get sign-off', done: true },
    { text: 'Write final copy', done: false },
  ]);
});

test('journal linking round-trips through link/get/unlink and matches file content', async () => {
  const ws = scratchWorkspace();
  const client = await connectedClient(ws);
  await client.callTool({ name: 'create_project', arguments: { name: 'Website Redesign' } });
  const task = expectOk<{ id: string }>(
    (await client.callTool({
      name: 'create_task',
      arguments: { projectSlug: 'website-redesign', text: 'Draft homepage copy' },
    })) as CallToolResult,
  );

  const linked = expectOk<{ frontmatter: { linkedTasks: string[] } }>(
    (await client.callTool({
      name: 'link_task_to_journal',
      arguments: { date: '2026-09-10', taskId: task.id },
    })) as CallToolResult,
  );
  assert.deepEqual(linked.frontmatter.linkedTasks, [task.id]);

  const entry = expectOk<{ frontmatter: { linkedTasks: string[] } }>(
    (await client.callTool({ name: 'get_journal_entry', arguments: { date: '2026-09-10' } })) as CallToolResult,
  );
  assert.deepEqual(entry.frontmatter.linkedTasks, [task.id]);

  const unlinked = expectOk<{ frontmatter: { linkedTasks: string[] } }>(
    (await client.callTool({
      name: 'unlink_task_from_journal',
      arguments: { date: '2026-09-10', taskId: task.id },
    })) as CallToolResult,
  );
  assert.deepEqual(unlinked.frontmatter.linkedTasks, []);
  assert.equal(getHistory(ws)[0].message, `[mcp:unlink_task_from_journal] unlink_task ${task.id} from 2026-09-10`);
});

test('get_task_summary returns structured aggregates, not prose', async () => {
  const ws = scratchWorkspace();
  const client = await connectedClient(ws);
  await client.callTool({ name: 'create_project', arguments: { name: 'Website Redesign' } });
  await client.callTool({ name: 'create_task', arguments: { projectSlug: 'website-redesign', text: 'A' } });
  await client.callTool({ name: 'create_task', arguments: { projectSlug: 'website-redesign', text: 'B' } });

  const summary = expectOk<{ totalCount: number; byStatus: Record<string, number>; byProject: { projectSlug: string; count: number }[] }>(
    (await client.callTool({ name: 'get_task_summary', arguments: {} })) as CallToolResult,
  );
  assert.equal(summary.totalCount, 2);
  assert.equal(summary.byStatus.todo, 2);
  assert.deepEqual(summary.byProject, [{ projectSlug: 'website-redesign', projectName: 'Website Redesign', count: 2 }]);
});

test('an unknown project slug returns a structured error with a did-you-mean hint, not a thrown protocol failure', async () => {
  const ws = scratchWorkspace();
  const client = await connectedClient(ws);
  await client.callTool({ name: 'create_project', arguments: { name: 'Website Redesign' } });

  const result = (await client.callTool({
    name: 'get_project',
    arguments: { slug: 'wbsite-redesign' },
  })) as CallToolResult;
  const message = expectError(result);
  assert.match(message, /no project with slug/);
  assert.match(message, /did you mean: website-redesign/);
});

test('an unwanted agent change can be cleanly reverted via the same git history the REST API uses', async () => {
  const ws = scratchWorkspace();
  const client = await connectedClient(ws);
  await client.callTool({ name: 'create_project', arguments: { name: 'Website Redesign' } });
  const task = expectOk<{ id: string }>(
    (await client.callTool({
      name: 'create_task',
      arguments: { projectSlug: 'website-redesign', text: 'Draft homepage copy' },
    })) as CallToolResult,
  );

  // The "unwanted" change: an agent marks the task done.
  const done = expectOk<{ status: string }>(
    (await client.callTool({
      name: 'update_task',
      arguments: { projectSlug: 'website-redesign', taskId: task.id, status: 'done' },
    })) as CallToolResult,
  );
  assert.equal(done.status, 'done');
  assert.match(fs.readFileSync(path.join(ws, 'projects', 'website-redesign.md'), 'utf8'), /- \[x\]/);

  // Revert it (the same lib/vaultGit.ts revertCommit routes/vault.ts's
  // POST /api/vault/revert/:commit calls) and confirm the file is back to
  // todo — the undo mechanism is independent of which front door (REST or
  // MCP) made the original change.
  const mostRecent = getHistory(ws)[0];
  assert.equal(mostRecent.message, `[mcp:update_task] update_task ${task.id} status todo→done (website-redesign)`);
  revertCommit(ws, mostRecent.hash);

  const onDisk = fs.readFileSync(path.join(ws, 'projects', 'website-redesign.md'), 'utf8');
  assert.match(onDisk, /- \[ \]/);
  assert.doesNotMatch(onDisk, /- \[x\]/);
});
