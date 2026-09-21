import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as api from '../api/client';

/**
 * Pinned-projects/pinned-notes selections (Dashboard's "Pinned" section,
 * replacing the old "Recent projects" section) — an app-wide preference
 * (`~/.poco/config.json`, PLAN.md's Dashboard route bullet), not vault
 * content, same storage choice as the dashboard group filter. Shared
 * between every page that renders a `ProjectCard`/`NoteRow` with a pin
 * toggle (`ProjectsListPage`, `NotesListPage`, `DashboardPage`) so toggling
 * a pin anywhere updates the same cached list everywhere.
 */
export function usePinnedProjects() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['pinnedProjects'], queryFn: api.getPinnedProjectsPreference });
  const pinnedProjectSlugs = data?.slugs ?? [];

  const mutation = useMutation({
    mutationFn: (slugs: string[]) => api.setPinnedProjectsPreference(slugs),
    onSuccess: (result) => queryClient.setQueryData(['pinnedProjects'], result),
  });

  function togglePinnedProject(slug: string) {
    const next = pinnedProjectSlugs.includes(slug) ? pinnedProjectSlugs.filter((s) => s !== slug) : [...pinnedProjectSlugs, slug];
    mutation.mutate(next);
  }

  return { pinnedProjectSlugs, togglePinnedProject };
}

export function usePinnedNotes() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['pinnedNotes'], queryFn: api.getPinnedNotesPreference });
  const pinnedNoteSlugs = data?.slugs ?? [];

  const mutation = useMutation({
    mutationFn: (slugs: string[]) => api.setPinnedNotesPreference(slugs),
    onSuccess: (result) => queryClient.setQueryData(['pinnedNotes'], result),
  });

  function togglePinnedNote(slug: string) {
    const next = pinnedNoteSlugs.includes(slug) ? pinnedNoteSlugs.filter((s) => s !== slug) : [...pinnedNoteSlugs, slug];
    mutation.mutate(next);
  }

  return { pinnedNoteSlugs, togglePinnedNote };
}
