# pivot

A personal, local-first daily-tasks + journal app backed entirely by plain
markdown files — tasks grouped by project, journal/daily notes bucketed by
year. No hosted backend, no accounts, no lock-in: your vault is just a folder
of `.md` files you can read, edit, `grep`, sync, or back up with any tool you
already use.

Ships as an **Electron desktop app** (planned — see [Status](#status)), with
AI-agent access (Claude Code, Claude Desktop, or any other MCP client) via a
built-in **MCP server**, git-backed versioning as an undo mechanism for any
edit — human or agent — and optional git-remote sync.

> **Early development.** Most of this README describes where the project is
> headed, not what's runnable today. See [Status](#status) below for what
> actually works right now.

## Why

Existing markdown-based tools (Obsidian, Logseq, Dendron, org-mode/org-journal,
Foam, SilverBullet) all get close, but none match "one task file per project,
one journal file per day, grouped by year" without heavy plugin configuration
or accepting a different file-per-unit convention. `pivot` is built around
that exact layout from the ground up. Full design rationale lives in
[PLAN.md](PLAN.md).

## Features

- **Markdown is the source of truth.** Every task and journal entry is a plain
  `.md` file on your disk. A `node:sqlite` index is a derived, always-rebuildable
  cache — never a place data lives that isn't also in the files. Delete it,
  reopen the app, get identical results.
- **Rich tasks**: description, creation time, tags, due date, and automatic
  time-tracking — move a task to "doing" and the clock starts, no manual timer.
- **Projects** carry a description, tags, and a color (for calendar marks).
- **Journal entries** can link to the tasks you worked on that day.
- **Multiple workspaces**, Obsidian-style — point the app at any folder.
- **Git-backed history**: every workspace is its own git repo, auto-committed
  on every write, so any unwanted change (yours or an AI agent's) is a
  one-click revert away. Optional push/pull to a remote for backup/sync.
- **MCP server** for agent access — full read/write tools over the same
  service layer the app itself uses, so any MCP-capable agent (Claude Code,
  Claude Desktop, etc.) can manage and summarize your tasks and journal
  directly.
- **Daily reminder**: a native OS notification if you haven't journaled yet
  today, from a tray-resident background app.

## Status

Tracked in [PROGRESS.md](PROGRESS.md) against the milestone list in
[PLAN.md](PLAN.md). Short version: the on-disk markdown format (parsing +
serializing tasks/projects/journal entries, byte-for-byte round-trip tested)
is done. The Express backend, MCP server, React frontend, and Electron shell
have not been built yet.

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
cd pivot
npm install
```

This is an [npm workspaces](https://docs.npmjs.com/cli/v10/using-npm/workspaces)
monorepo (`server/`, `client/`, and eventually `electron/`) — one `npm install`
at the root installs everything.

### Run the tests

The only thing fully built so far is the markdown core (task-line grammar,
project/journal frontmatter parsing and serialization). Run its tests from
the repo root:

```bash
npm test
```

This runs the server package's test suite (`node`'s built-in test runner via
`tsx`), including a byte-for-byte round-trip check: parse a sample project
and journal file, serialize the result back out, and confirm the output is
identical to the input.

### Typecheck

```bash
npm run build -w server
```

(or `npx tsc --noEmit -w server` for a check without emitting output).

### Run the app

Not available yet — there's no server entry point, no client, and no
Electron shell built yet. Once the backend + frontend milestones land,
this section will cover:

```bash
npm run dev     # server + client, concurrently, for local development
```

And once the Electron shell milestone lands, building/installing the actual
desktop app:

```bash
npm run build -w electron   # produces a packaged, installable app
```

Check [PROGRESS.md](PROGRESS.md) for which of these actually work today.

## Project structure

```
pivot/
  server/     # Express + TypeScript backend, markdown core, SQLite index, MCP server
  client/     # Vite + React + TypeScript frontend (not started)
  electron/   # Electron desktop shell (not started)
  design/     # UI prototype (Claude Design canvas source)
  vault/      # a convenience default/dev workspace — not a hardcoded runtime path
```

## Documentation

- [PLAN.md](PLAN.md) — the full design doc: storage format, backend
  architecture, MCP tools, git-backed backup/sync, Electron shell, daily
  reminder, milestones.
- [PROGRESS.md](PROGRESS.md) — what's actually built vs. planned, and the
  key-decisions log.
- [CLAUDE.md](CLAUDE.md) — working conventions for AI coding sessions on
  this repo.

## License

[GNU AGPLv3](LICENSE) — free to use, fork, modify, and even sell or host
commercially, with one condition: if you run a modified version and let
others interact with it over a network (e.g. as a hosted service), you must
offer them the corresponding source code. Closes the "SaaS loophole" that
plain GPL leaves open, so improvements — commercial or not — stay available
to everyone rather than disappearing into a closed-source fork.
