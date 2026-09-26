import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import * as api from "../api/client";
import NoteRow from "../components/NoteRow";
import ProjectCard from "../components/ProjectCard";
import QuickAddTaskModal from "../components/QuickAddTaskModal";
import SearchModal from "../components/SearchModal";
import TaskRow from "../components/TaskRow";
import AnimatedWeatherWidget from "../components/AnimatedWeatherWidget";
import {
  daysBetween,
  formatDateLong,
  formatTimestamp,
  todayStr,
  yearOf,
} from "../lib/date";
import { usePinnedNotes, usePinnedProjects } from "../lib/pins";
import { shortcutLabel } from "../lib/shortcuts";
import { toTask } from "../lib/tasks";
import type { IndexedTask, TaskStatus } from "../types";

/** Each task bucket (Doing/Today/Overdue/This week) below the fold shows at
 * most this many rows by default — same "+N more"/"Show fewer" collapse
 * pattern used elsewhere (ProjectDetailPage's Done column, HistoryPanel). */
const BUCKET_LIMIT = 10;

/** ⌘ on Mac, Ctrl everywhere else — matches how every app using this same
 * Cmd/Ctrl+K "open search" convention (VS Code, Slack, Notion, Linear,
 * GitHub) displays its own shortcut hint. */
const SEARCH_SHORTCUT_LABEL = shortcutLabel("K");

export default function DashboardPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.language === "vi" ? "vi" : "en";
  const queryClient = useQueryClient();
  const today = todayStr();
  const year = yearOf(today);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["tasks", "open"],
    queryFn: api.getOpenTasks,
  });
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
  });
  const notesQuery = useQuery({
    queryKey: ["notes"],
    queryFn: () => api.listNotes(),
  });
  const { pinnedProjectSlugs, togglePinnedProject } = usePinnedProjects();
  const { pinnedNoteSlugs, togglePinnedNote } = usePinnedNotes();

  const [addingTask, setAddingTask] = useState(false);
  const [searching, setSearching] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [expandedBuckets, setExpandedBuckets] = useState<
    Record<string, boolean>
  >({});
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [groupFilters, setGroupFilters] = useState<string[]>([]);

  // Persists across restarts (`~/.jota/config.json` via
  // `GET/PUT /api/preferences/dashboard-pinned-open`) — same
  // fetch-once-and-apply-on-top-of-the-default shape as CalendarPage's
  // `calendarMode`/`granularity` toggles.
  const { data: pinnedOpenData } = useQuery({
    queryKey: ["dashboardPinnedOpenPreference"],
    queryFn: () => api.getDashboardPinnedOpenPreference(),
  });
  useEffect(() => {
    if (pinnedOpenData) setPinnedOpen(pinnedOpenData.open);
  }, [pinnedOpenData]);
  const setPinnedOpenMutation = useMutation({
    mutationFn: (next: boolean) => api.setDashboardPinnedOpenPreference(next),
  });
  function togglePinnedOpen() {
    const next = !pinnedOpen;
    setPinnedOpen(next);
    setPinnedOpenMutation.mutate(next);
  }

  function toggleTagFilter(tag: string) {
    setTagFilters((current) =>
      current.includes(tag)
        ? current.filter((existing) => existing !== tag)
        : [...current, tag],
    );
  }

  // Persists across restarts (`~/.jota/config.json` via
  // `GET/PUT /api/preferences/dashboard-group-filter`) — same
  // fetch-once-and-apply-on-top-of-the-default shape as `pinnedOpen` just
  // above. Unlike `pinnedOpen` (a simple boolean), a stored
  // group name can go stale (its project renamed/regrouped/deleted, or a
  // different workspace's groups) — `bucketTasks` below always intersects
  // this against the *current* workspace's live group set before applying
  // it, so a stale entry silently has no effect rather than zeroing out
  // every bucket with no visible explanation.
  const { data: groupFilterData } = useQuery({
    queryKey: ["dashboardGroupFilterPreference"],
    queryFn: () => api.getDashboardGroupFilterPreference(),
  });
  useEffect(() => {
    if (groupFilterData) setGroupFilters(groupFilterData.groups);
  }, [groupFilterData]);
  const setGroupFilterMutation = useMutation({
    mutationFn: (groups: string[]) =>
      api.setDashboardGroupFilterPreference(groups),
  });
  function toggleGroupFilter(group: string) {
    setGroupFilters((current) => {
      const next = current.includes(group)
        ? current.filter((existing) => existing !== group)
        : [...current, group];
      setGroupFilterMutation.mutate(next);
      return next;
    });
  }
  function clearGroupFilters() {
    setGroupFilters([]);
    setGroupFilterMutation.mutate([]);
  }

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["tasks", "open"] });
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    queryClient.invalidateQueries({ queryKey: ["calendar"] });
  }

  const updateTaskMutation = useMutation({
    mutationFn: ({
      slug,
      taskId,
      values,
    }: {
      slug: string;
      taskId: string;
      values: api.UpdateTaskInput;
    }) => api.updateTask(slug, taskId, values),
    onSuccess: invalidate,
  });

  const deleteTaskMutation = useMutation({
    mutationFn: ({ slug, taskId }: { slug: string; taskId: string }) =>
      api.deleteTask(slug, taskId),
    onSuccess: invalidate,
  });

  const logTodayMutation = useMutation({
    mutationFn: (taskId: string) => api.linkTaskToJournal(year, today, taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journalEntry", today] });
      queryClient.invalidateQueries({ queryKey: ["journalYear", year] });
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
    },
  });

  const projects = projectsQuery.data?.projects ?? [];
  const selectableProjects = projects.filter((p) => !p.frontmatter.archived);
  // Ordered by `pinnedProjectSlugs` (i.e. pin order, oldest-pinned-first)
  // rather than the project list's own order — a stale slug (project
  // deleted since, or archived) is silently dropped, same reasoning as the
  // group filter's own staleness handling above.
  const pinnedProjects = pinnedProjectSlugs
    .map((slug) => selectableProjects.find((p) => p.slug === slug))
    .filter((p): p is (typeof selectableProjects)[number] => !!p);
  const notes = notesQuery.data?.notes ?? [];
  const pinnedNotes = pinnedNoteSlugs
    .map((slug) => notes.find((n) => n.slug === slug))
    .filter((n): n is (typeof notes)[number] => !!n);

  const open = data?.tasks ?? [];

  // Task-bucket tag filter — same OR-matched, widening-not-narrowing
  // toggle-pill pattern as ProjectsListPage/NotesListPage's tag filters,
  // applied to the buckets below rather than the search popup (a separate,
  // unrelated filter over the same already-loaded task list; the popup's
  // own clickable tag pills now live in `SearchModal`, sourced from its own
  // open-tasks fetch).
  // `allBucketTags`/`allBucketGroups` stay derived from every open task (not
  // `bucketTasks`) so picking a filter never removes other tags/groups from
  // their own pill row. The group filter (PLAN.md "organize projects into
  // groups") is a second, independent filter dimension — AND'd with the tag
  // filter, OR'd within its own selected groups, same as the tag filter is
  // within itself.
  const allBucketTags = [...new Set(open.flatMap((t) => t.tags))].sort();
  const allBucketGroups = [...new Set(open.map((t) => t.projectGroup))].sort();
  // Intersected against `allBucketGroups` so a persisted-but-now-stale group
  // (renamed/regrouped/deleted since, or left over from a different
  // workspace) silently drops out instead of matching zero tasks and
  // blanking every bucket with no visible pill to explain why.
  const activeGroupFilters = groupFilters.filter((g) =>
    allBucketGroups.includes(g),
  );
  const bucketTasks = open
    .filter(
      (t) =>
        tagFilters.length === 0 ||
        t.tags.some((tag) => tagFilters.includes(tag)),
    )
    .filter(
      (t) =>
        activeGroupFilters.length === 0 ||
        activeGroupFilters.includes(t.projectGroup),
    );

  const overdue: IndexedTask[] = [];
  const dueToday: IndexedTask[] = [];
  const week: IndexedTask[] = [];
  for (const t of bucketTasks) {
    if (!t.due) continue;
    const diff = daysBetween(today, t.due);
    if (diff < 0) overdue.push(t);
    else if (diff === 0) dueToday.push(t);
    else if (diff <= 7) week.push(t);
  }
  // Everything currently in progress, regardless of due date — a task with
  // no due date (or one due further out) would otherwise never appear on
  // the Dashboard at all despite actively tracking time. Deliberately not
  // exclusive with the due-date buckets above: the same task can show up
  // both here and in e.g. Overdue, since "what's overdue" and "what am I
  // actively working on" are different questions worth answering separately.
  const doing = bucketTasks.filter((t) => t.status === "doing");

  function renderTaskRow(t: IndexedTask) {
    return (
      <TaskRow
        key={t.id}
        task={toTask(t)}
        project={{
          name: t.projectName,
          color: t.projectColor,
          slug: t.projectSlug,
        }}
        onStatusChange={(status: TaskStatus) =>
          updateTaskMutation.mutate({
            slug: t.projectSlug,
            taskId: t.id,
            values: { status },
          })
        }
        onSave={(values) =>
          updateTaskMutation.mutate({
            slug: t.projectSlug,
            taskId: t.id,
            values,
          })
        }
        onDelete={() =>
          deleteTaskMutation.mutate({ slug: t.projectSlug, taskId: t.id })
        }
        onLogToday={() => logTodayMutation.mutate(t.id)}
      />
    );
  }

  function renderBucket(
    key: string,
    title: string,
    tasks: IndexedTask[],
    opts: { hideIfEmpty?: boolean; emptyLabel?: string } = {},
  ) {
    if (tasks.length === 0 && opts.hideIfEmpty) return null;
    const expanded = expandedBuckets[key] ?? false;
    const visibleTasks = expanded ? tasks : tasks.slice(0, BUCKET_LIMIT);
    const hiddenCount = tasks.length - visibleTasks.length;
    return (
      <div className="bucket" key={key}>
        <div className="bucket-title">
          {title} <span className="count">{tasks.length}</span>
        </div>
        <div className="task-list">
          {visibleTasks.map(renderTaskRow)}
          {tasks.length === 0 && opts.emptyLabel && (
            <div className="empty-note">{opts.emptyLabel}</div>
          )}
        </div>
        {hiddenCount > 0 && (
          <button
            type="button"
            className="list-toggle-btn"
            onClick={() => setExpandedBuckets((m) => ({ ...m, [key]: true }))}
          >
            {t("dashboard.showMore", { count: hiddenCount })}
          </button>
        )}
        {expanded && tasks.length > BUCKET_LIMIT && (
          <button
            type="button"
            className="list-toggle-btn"
            onClick={() => setExpandedBuckets((m) => ({ ...m, [key]: false }))}
          >
            {t("dashboard.showFewer")}
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">{t("dashboard.title")}</h1>
            {/* <h1 className="page-title">Jota</h1> */}
            <AnimatedWeatherWidget />
          </div>
          <div className="page-sub">{formatDateLong(today, language)}</div>
        </div>
        <div className="dashboard-header-actions">
          <button
            type="button"
            className="btn-secondary icon-only-btn icon-only-btn-round"
            title={`${t("dashboard.searchEverything")} (${SEARCH_SHORTCUT_LABEL})`}
            aria-label={t("dashboard.searchEverything")}
            onClick={() => setSearching(true)}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </button>
          <Link
            className="journal-cta"
            to={`/journal/${year}/${today}`}
            title={`${t("dashboard.openTodaysJournal")} (${shortcutLabel("J")})`}
          >
            {t("dashboard.openTodaysJournal")}
          </Link>
          <button
            type="button"
            className="journal-cta"
            title={`${t("dashboard.addTask")} (${shortcutLabel("T")})`}
            onClick={() => setAddingTask(true)}
          >
            {t("dashboard.addTask")}
          </button>
        </div>
      </div>

      {searching && <SearchModal onClose={() => setSearching(false)} />}

      {addingTask && <QuickAddTaskModal onClose={() => setAddingTask(false)} />}

      {(pinnedProjects.length > 0 || pinnedNotes.length > 0) && (
        <div className="dashboard-section dashboard-pinned-section bucket">
          <button
            type="button"
            className="bucket-title bucket-title-toggle"
            onClick={togglePinnedOpen}
          >
            <span className={`disclosure-caret ${pinnedOpen ? "open" : ""}`}>
              ▸
            </span>
            {t("dashboard.pinned")}
          </button>
          {pinnedOpen && (
            <>
              {pinnedProjects.length > 0 && (
                <div className="projects-grid">
                  {pinnedProjects.map((p) => (
                    <ProjectCard
                      key={p.slug}
                      project={p}
                      variant="grid"
                      pinned
                      onTogglePin={() => togglePinnedProject(p.slug)}
                    />
                  ))}
                </div>
              )}
              {pinnedNotes.length > 0 && (
                <div className="notes-list dashboard-pinned-notes">
                  {pinnedNotes.map((n) => (
                    <NoteRow
                      key={n.slug}
                      note={n}
                      updatedLabel={formatTimestamp(n.updated)}
                      pinned
                      onTogglePin={() => togglePinnedNote(n.slug)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="dashboard-section dashboard-filters-and-tasks">
        {(allBucketGroups.length > 1 || allBucketTags.length > 0) && (
          <div className="dashboard-filters">
            {allBucketGroups.length > 1 && (
              <div className="tag-filter-row dashboard-tag-filter-row group-filter-row">
                <span className="filter-facet-label">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  {t("dashboard.filterByGroup")}
                </span>
                {allBucketGroups.map((group) => (
                  <button
                    key={group}
                    type="button"
                    className={`tag-pill tag-pill-filter group-pill-filter ${groupFilters.includes(group) ? "active" : ""}`}
                    onClick={() => toggleGroupFilter(group)}
                  >
                    {group}
                  </button>
                ))}
                {activeGroupFilters.length > 0 && (
                  <button
                    type="button"
                    className="tag-filter-clear"
                    onClick={clearGroupFilters}
                  >
                    {t("dashboard.clear")}
                  </button>
                )}
              </div>
            )}

            {allBucketTags.length > 0 && (
              <div className="tag-filter-row dashboard-tag-filter-row">
                <span className="filter-facet-label">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20.59 13.41 13.42 20.59a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                    <line x1="7" y1="7" x2="7.01" y2="7" />
                  </svg>
                  {t("dashboard.filterByTag")}
                </span>
                {allBucketTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className={`tag-pill tag-pill-filter ${tagFilters.includes(tag) ? "active" : ""}`}
                    onClick={() => toggleTagFilter(tag)}
                  >
                    {tag}
                  </button>
                ))}
                {tagFilters.length > 0 && (
                  <button
                    type="button"
                    className="tag-filter-clear"
                    onClick={() => setTagFilters([])}
                  >
                    {t("dashboard.clear")}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {isLoading && (
          <p className="page-sub">{t("dashboard.loadingOpenTasks")}</p>
        )}
        {isError && (
          <p className="field-error">
            {error instanceof api.ApiError
              ? error.message
              : t("dashboard.failedToLoad")}
          </p>
        )}

        {!isLoading && !isError && (
          <div className="dashboard-tasks">
            {renderBucket("doing", t("dashboard.buckets.doing"), doing, {
              hideIfEmpty: true,
            })}
            {renderBucket("today", t("dashboard.buckets.today"), dueToday, {
              emptyLabel: t("dashboard.nothingDueToday"),
            })}
            {renderBucket("overdue", t("dashboard.buckets.overdue"), overdue, {
              hideIfEmpty: true,
            })}
            {renderBucket("thisWeek", t("dashboard.buckets.thisWeek"), week)}
          </div>
        )}
      </div>
    </div>
  );
}
