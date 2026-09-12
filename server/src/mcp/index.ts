#!/usr/bin/env node
// MCP server entrypoint (PLAN.md "Agent access via MCP", milestone 10) — a
// standalone stdio process, separate from the Express server, exposing the
// same services/*.ts functions the REST routes use as MCP tools. Registered
// with an MCP host via `claude mcp add` or `.mcp.json`; never imported by
// the Express app.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { ensureGitHistory } from '../lib/vaultGit.js';
import { scaffoldWorkspaceDirs } from '../lib/workspaces.js';
import { getActiveWorkspace } from '../services/workspaces.js';
import { registerTools } from './tools.js';

/**
 * Resolves the workspace this process targets, once, at startup:
 * `POCO_WORKSPACE` if set, else the app registry's currently-active
 * workspace. Resolved exactly once — not re-read per tool call — so an
 * agent's target vault can't silently change mid-conversation just because
 * someone switched workspaces in the running app (PLAN.md: "MCP is
 * decoupled from 'whichever workspace the app has open'").
 */
function resolveWorkspacePath(): string {
  const envPath = process.env.POCO_WORKSPACE?.trim();
  if (envPath) return envPath;

  const active = getActiveWorkspace();
  if (!active) {
    throw new Error(
      'No workspace to target: set the POCO_WORKSPACE environment variable to a workspace path, or open one in the poco app first.',
    );
  }
  return active.path;
}

async function main() {
  const workspacePath = resolveWorkspacePath();

  // Self-heal the same way opening a workspace in the app does (PLAN.md
  // "Workspaces": ".poco/ ... otherwise travels with the folder if
  // copied ... or self-heals via reconciliation") — lets an MCP host point
  // straight at a plain folder that was never registered through the app.
  scaffoldWorkspaceDirs(workspacePath);
  ensureGitHistory(workspacePath);

  const server = new McpServer({ name: 'poco', version: '0.1.0' });
  registerTools(server, workspacePath);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only — stdout is the JSON-RPC transport channel.
  console.error(`poco MCP server running on stdio, targeting workspace: ${workspacePath}`);
}

main().catch((err) => {
  console.error('poco MCP server failed to start:', err);
  process.exit(1);
});
