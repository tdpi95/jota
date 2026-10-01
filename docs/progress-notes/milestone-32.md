# Milestone 32 notes (Links between journals, notes and tasks)

[← back to PROGRESS.md](../../PROGRESS.md)

Requested by the user (2026-10-01): "find a way to link between journals, notes and tasks". The design is in PLAN.md's "Links between journals, notes and tasks" section. The forks were confirmed with `AskUserQuestion` before building: inline wikilinks, any→any with backlinks, and all three UI pieces.

This work followed a smaller change in the same session, also recorded here:

- **Linked-tasks block**: each journal file ends with a generated, titles-only `<!-- jota:linked-tasks -->` block (`lib/markdown/linkedTasksBlock.ts`) so the links read in other markdown viewers. `parseJournalFile` strips it and `serializeJournalFile(parsed, titles)` regenerates it, so the body the app sees never contains it and it never counts toward `hasBody`. It is refreshed on link/unlink/save, and on task rename/delete via `refreshLinkedTaskTitles` (one commit for every affected file). It carries no status, deliberately: that would go stale on any task change made outside the app.
- **Linked-tasks UI**: the chips on the journal day page became a list with a read-only status icon, the project, and a remove button.

## What was built for links

- `lib/markdown/wikilinks.ts` (server) and `client/src/lib/wikilinks.ts` share one syntax. The two copies must stay in sync.
- `wikilinks` index table (`lib/index/db.ts`), filled in `reindex.ts` for journal bodies, note bodies and task descriptions. A new table doesn't re-parse untouched files by itself, so creating it zeroes `source_mtime` on projects, journal entries and notes (same backfill trick as `projects_fts`).
- `services/links.ts`, `routes/links.ts`, MCP `get_backlinks`.
- Client: markdown-it `wikilink` inline rule (`renderMarkdown.ts`), `useWikilinkPreview` (resolve + in-app click handling), the `[[` autocomplete (`wikilinkCompletion.ts`, via `@codemirror/autocomplete`, now a direct dependency), and the `Backlinks` component.

## Gotchas

- A note linked by title breaks when the note is retitled; a slug link doesn't. A slug that equals the old title (case-insensitively) keeps matching, which is why the rename test uses a title whose slug differs.
- Links inside decrypted text resolve once unlocked: `useBodyEncryption` feeds the decrypted plaintexts into the link lookup.
- Backlinks are read from the index, which every write reconciles, so they are current right after a save but can lag behind an outside edit until the next reconcile.

## Verified live

Against a scratch `HOME` and workspace (the real vault was not touched): a journal entry rendered a note link, a task link (resolved to the task's title) and a dangling link, with the `` `[[code]]` `` span left literal. The note page and the task detail view both listed their backlinks. In the editor, typing `[[Fix` offered the task with its project, and Enter wrote `[[t_a217e4|Fix login bug]]`.
