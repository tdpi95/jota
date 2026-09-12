# poco

A personal, local-first daily-tasks + journal app backed entirely by plain
markdown files — tasks grouped by project, journal/daily notes bucketed by
year. No hosted backend, no accounts, no lock-in: your vault is just a folder
of `.md` files you can read, edit, `grep`, sync, or back up with any tool you
already use.

Ships as an **Electron desktop app**, with AI-agent access (Claude Code,
Claude Desktop, or any other MCP client) via a built-in **MCP server**,
git-backed versioning as an undo mechanism for any edit — human or agent —
and optional git-remote sync. Available in English and Vietnamese.

> **Status: feature-complete, polish in progress.** Every core milestone
> (markdown core, backend, MCP server, frontend, Electron shell, daily
> reminder, localization) is built and working end-to-end. What's left is
> polish — see [Status](#status) below.

## Why

Existing markdown-based tools (Obsidian, Logseq, Dendron, org-mode/org-journal,
Foam, SilverBullet) all get close, but none match "one task file per project,
one journal file per day, grouped by year" without heavy plugin configuration
or accepting a different file-per-unit convention. `poco` is built around
that exact layout from the ground up. Full design rationale lives in
[PLAN.md](PLAN.md).

## Features

- **Markdown is the source of truth.** Every task and journal entry is a plain
  `.md` file on your disk. A `node:sqlite` index is a derived, always-rebuildable
  cache — never a place data lives that isn't also in the files. Delete it,
  reopen the app, get identical results.
- **Rich tasks**: description, creation time, tags, due date, and automatic
  time-tracking — move a task to "doing" and the clock starts, no manual timer.
  Drag-and-drop between Todo/Doing/Done columns.
- **Projects** carry a description, tags, and a color (from a preset palette
  or any custom hex) shown as calendar marks and badges.
- **Journal entries** can link to the tasks you worked on that day, with a
  searchable task picker.
- **Dashboard**: today/overdue/this-week task buckets across all projects,
  recent projects, quick-add, and a task/tag search popup.
- **Calendar sidebar**: month grid marking due dates and journal entries,
  click-through to any day.
- **Multiple workspaces**, Obsidian-style — point the app at any folder via
  a native folder picker, switch between registered workspaces anytime.
- **Git-backed history**: every workspace is its own git repo, auto-committed
  on every write, tagged by origin (`[api]` vs `[mcp:<tool>]`) — any unwanted
  change (yours or an AI agent's) is a one-click revert away, with a diff
  view. Optional push/pull to a remote for backup/sync, with structured
  conflict surfacing.
- **MCP server** for agent access — 14 read/write tools over the same
  service layer the app itself uses (create/update projects and tasks,
  journal entries and links, task search/summary), so any MCP-capable agent
  (Claude Code, Claude Desktop, etc.) can manage and summarize your tasks
  and journal directly. Targets an explicit workspace via `POCO_WORKSPACE`,
  independent of whatever workspace the app itself has open.
- **Daily reminder**: a native OS notification if you haven't journaled yet
  today, from a tray-resident background app (the app stays running in the
  tray after the window closes; only "Quit" actually quits). Launch-at-login
  and reminder time are configurable in Settings.
- **Localization**: English and Vietnamese, switchable instantly in Settings,
  covering the full UI plus the Electron tray menu and reminder notification.

## Status

Tracked in [PROGRESS.md](PROGRESS.md) against the milestone list in
[PLAN.md](PLAN.md). Short version: milestones 1–17 and 19 (localization) are
done and verified (each against its own Verify step, not just "code
written"). Milestone 18 (Polish) is in progress — task drag-and-drop, the
project modal, a custom color picker, and a projects tag filter are done;
first-run state, loading/error states, a backup job, and `electron-builder`
packaging config are still outstanding.

Read [CLAUDE.md](CLAUDE.md) if you're picking this project up in an AI coding
session — it's the working-conventions guide for this repo.

## Requirements

- [Node.js](https://nodejs.org/) **≥ 22.5** (for the built-in `node:sqlite`
  module — no native module to compile)
- [git](https://git-scm.com/) (each workspace is a git repo; the app shells
  out to your local git install)

Check your Node version:

```bash
node --version
```

## Getting started (development)

```bash
git clone <this-repo-url>
cd poco
npm install
```

This is an [npm workspaces](https://docs.npmjs.com/cli/v10/using-npm/workspaces)
monorepo (`server/`, `client/`, `electron/`) — one `npm install` at the root
installs everything.

### Run the app

```bash
npm run dev
```

Launches the Vite client and the Electron shell together (the Electron main
process embeds the Express server and points a `BrowserWindow` at it — the
renderer talks to `/api/...` over plain HTTP, same as a web app would).
First run prompts you to pick a workspace folder.

### Run the tests

```bash
npm test
```

Runs the server package's test suite (`node`'s built-in test runner via
`tsx`) — markdown round-trip parsing/serialization, services, MCP tools
(driven through a real `@modelcontextprotocol/sdk` client), workspace
registry, git-backed history/revert, sync, and more.

### Typecheck

```bash
npx tsc --noEmit -w server
npx tsc --noEmit -w client
npx tsc --noEmit -w electron
```

### Run the MCP server standalone

```bash
npm run mcp -w server
# or, targeting a specific workspace explicitly:
POCO_WORKSPACE=/path/to/workspace npx tsx server/src/mcp/index.ts
```

Exposes 14 tools (`create_project`, `create_task`, `update_task`,
`get_task_summary`, journal linking, search, etc.) over stdio to any MCP
host (Claude Code, Claude Desktop, ...). See [PLAN.md](PLAN.md) for the full
tool list and [PROGRESS.md](PROGRESS.md)'s "Milestone 10 notes" for how
workspace targeting works.

### Build the packaged desktop app

```bash
npm run build -w electron
```

Basic `electron-builder` packaging config is still outstanding (tracked
under milestone 18 in [PROGRESS.md](PROGRESS.md)) — for now, `npm run dev`
is the supported way to run the app.

## Project structure

```
poco/
  server/     # Express + TypeScript backend, markdown core, SQLite index, MCP server
  client/     # Vite + React + TypeScript frontend (i18n: en/vi)
  electron/   # Electron desktop shell — main process, tray, daily reminder
  design/     # UI prototype (Claude Design canvas source)
  vault/      # a convenience default/dev workspace — not a hardcoded runtime path
```

## Documentation

- [PLAN.md](PLAN.md) — the full design doc: storage format, backend
  architecture, MCP tools, git-backed backup/sync, Electron shell, daily
  reminder, localization, milestones.
- [PROGRESS.md](PROGRESS.md) — what's actually built vs. planned, milestone
  notes, and the key-decisions log.
- [CLAUDE.md](CLAUDE.md) — working conventions for AI coding sessions on
  this repo.

## License

[GNU AGPLv3](LICENSE) — free to use, fork, modify, and even sell or host
commercially, with one condition: if you run a modified version and let
others interact with it over a network (e.g. as a hosted service), you must
offer them the corresponding source code. Closes the "SaaS loophole" that
plain GPL leaves open, so improvements — commercial or not — stay available
to everyone rather than disappearing into a closed-source fork.
