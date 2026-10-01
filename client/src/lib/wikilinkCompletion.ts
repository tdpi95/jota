import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { QueryClient } from '@tanstack/react-query';
import i18n from 'i18next';

import * as api from '../api/client';
import { todayStr, addDays } from './date';
import { wikilinkInner, type LinkRef } from './wikilinks';

// The `[[` picker in the markdown editor (milestone 32): typing `[[` offers
// today/yesterday, matching notes, and matching tasks (open ones first) from
// the same cached lists the rest of the app already loads.

const MAX_OPTIONS = 12;
const KIND_RANK = { journal: 0, note: 1, task: 2 } as const;
const STATUS_RANK = { doing: 0, todo: 1, done: 2 } as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function candidates(queryClient: QueryClient, query: string): Promise<LinkRef[]> {
  const [projects, notes] = await Promise.all([
    queryClient.fetchQuery({ queryKey: ['projects'], queryFn: api.listProjects, staleTime: 10_000 }),
    queryClient.fetchQuery({ queryKey: ['notes'], queryFn: () => api.listNotes(), staleTime: 10_000 }),
  ]);
  const today = todayStr();
  const days = new Set([today, addDays(today, -1)]);
  if (DATE_RE.test(query)) days.add(query);
  const refs: LinkRef[] = [...days].map((date) => ({ kind: 'journal', id: date, title: date }));
  for (const note of notes.notes) refs.push({ kind: 'note', id: note.slug, title: note.title });
  for (const project of projects.projects) {
    for (const task of project.tasks) {
      refs.push({
        kind: 'task',
        id: task.id,
        title: task.text,
        status: task.status,
        projectSlug: project.slug,
        projectName: project.frontmatter.name,
        projectColor: project.frontmatter.color,
      });
    }
  }
  return refs;
}

/** Ranks a candidate against the typed text: prefix of the title/id first,
 * then substring, otherwise out (-1). With nothing typed everything stays. */
function score(ref: LinkRef, query: string): number {
  if (!query) return 0;
  const title = ref.title.toLowerCase();
  const id = ref.id.toLowerCase();
  if (title.startsWith(query) || id.startsWith(query)) return 0;
  if (title.includes(query) || id.includes(query)) return 1;
  return -1;
}

export function wikilinkCompletionSource(queryClient: QueryClient) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const match = context.matchBefore(/\[\[[^\[\]\n]*/);
    if (!match) return null;
    const query = match.text.slice(2).trim().toLowerCase();
    const refs = (await candidates(queryClient, query))
      .map((ref) => ({ ref, score: score(ref, query) }))
      .filter((r) => r.score >= 0)
      .sort(
        (a, b) =>
          a.score - b.score ||
          KIND_RANK[a.ref.kind] - KIND_RANK[b.ref.kind] ||
          STATUS_RANK[a.ref.status ?? 'todo'] - STATUS_RANK[b.ref.status ?? 'todo'],
      )
      .slice(0, MAX_OPTIONS);
    if (refs.length === 0) return null;

    const options: Completion[] = refs.map(({ ref }) => ({
      label: ref.title,
      detail: ref.kind === 'task' && ref.projectName ? ref.projectName : i18n.t(`links.kind.${ref.kind}`),
      // Insert what's needed to finish the link, and swallow a `]]` already
      // sitting after the cursor (editing inside an existing link).
      apply: (view, _completion, from, to) => {
        const insert = `${wikilinkInner(ref)}]]`;
        const end = view.state.sliceDoc(to, to + 2) === ']]' ? to + 2 : to;
        view.dispatch({ changes: { from, to: end, insert }, selection: { anchor: from + insert.length }, userEvent: 'input.complete' });
      },
    }));
    return { from: match.from + 2, options, filter: false };
  };
}
