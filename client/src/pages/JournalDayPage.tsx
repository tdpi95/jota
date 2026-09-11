import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import * as api from '../api/client';
import HistoryPanel from '../components/HistoryPanel';
import MarkdownTextarea from '../components/MarkdownTextarea';
import TagInput from '../components/TagInput';
import { addDays, formatDateLong, todayStr, yearOf } from '../lib/date';
import type { IndexedTask } from '../types';

const AUTOSAVE_DELAY_MS = 800;
const SEARCH_DEBOUNCE_MS = 300;

interface LinkedTaskInfo {
  id: string;
  title: string;
  projectColor: string;
}

export default function JournalDayPage() {
  const { date: dateParam } = useParams();
  const date = dateParam ?? todayStr();
  // Remounts the whole subtree (and so resets all local state below) every
  // time the date changes — simpler and less error-prone than reconciling
  // in-flight edits/autosave timers across a param change by hand.
  return <JournalDayPageInner key={date} date={date} />;
}

function JournalDayPageInner({ date }: { date: string }) {
  const year = yearOf(date);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const entryQuery = useQuery({ queryKey: ['journalEntry', date], queryFn: () => api.getJournalEntry(year, date) });
  // All projects (with their tasks embedded) — read directly from the
  // project files, not the index, so linked-task chip titles/colors are
  // never stale (PLAN.md "which reads go where"). There's no standalone
  // "get task by id" endpoint, so this doubles as that lookup.
  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: api.listProjects });

  const [body, setBody] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // `dirty` tracks "the user has typed/tagged something not yet persisted" —
  // set explicitly by the edit handlers below (handleBodyChange/handleTagsChange),
  // never inferred by diffing body/tags against the loaded entry. That
  // diffing approach was tried first and had a real race: the effect that
  // syncs freshly-loaded data into local state, and the debounce-scheduling
  // effect, both react to the *same* [body, tags] change, and on the render
  // where loaded data first lands there's a window where one has updated and
  // the other hasn't — enough for a spurious "unsaved change" to be detected
  // and an empty/stale value flushed to disk. Driving `dirty` only from the
  // actual onChange handlers removes the ambiguity entirely.
  const dirtyRef = useRef(false);
  const latestRef = useRef({ body: '', tags: [] as string[] });
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  latestRef.current = { body, tags };

  useEffect(() => {
    if (entryQuery.data) {
      setBody(entryQuery.data.entry.body);
      setTags(entryQuery.data.entry.frontmatter.tags);
    }
  }, [entryQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (input: api.PutJournalInput) => api.putJournalEntry(year, date, input),
    onSuccess: (result) => {
      setSaveState('saved');
      queryClient.setQueryData(['journalEntry', date], result);
      queryClient.invalidateQueries({ queryKey: ['journalYear', year] });
      // A body going empty<->non-empty flips the calendar sidebar's
      // journal-entry dot for this day.
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
    },
  });

  function scheduleSave(nextBody: string, nextTags: string[]) {
    dirtyRef.current = true;
    setSaveState('saving');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      dirtyRef.current = false;
      saveMutation.mutate({ body: nextBody, tags: nextTags });
    }, AUTOSAVE_DELAY_MS);
  }

  function handleBodyChange(next: string) {
    setBody(next);
    scheduleSave(next, tags);
  }

  function handleTagsChange(next: string[]) {
    setTags(next);
    scheduleSave(body, next);
  }

  // Flush any not-yet-debounced edit when navigating away (prev/next day,
  // another page) — without this, an edit made just before leaving is
  // silently dropped when the pending debounce timer above gets cleared by
  // unmount before it ever fires. Fire-and-forget: the request itself
  // outlives the component (it's a plain fetch, not tied to React), and
  // there's nothing left mounted to show a result against.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (!dirtyRef.current) return;
      const latest = latestRef.current;
      api.putJournalEntry(year, date, { body: latest.body, tags: latest.tags }).catch((err) => {
        console.error('failed to flush journal autosave on navigation:', err);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(pickerQuery), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [pickerQuery]);

  const searchQuery = useQuery({
    queryKey: ['taskSearch', debouncedQuery],
    queryFn: () => api.searchTasks(debouncedQuery),
    enabled: pickerOpen && debouncedQuery.trim().length > 0,
  });

  const linkMutation = useMutation({
    mutationFn: (taskId: string) => api.linkTaskToJournal(year, date, taskId),
    onSuccess: (result) => {
      queryClient.setQueryData(['journalEntry', date], result);
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
      setPickerOpen(false);
      setPickerQuery('');
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: (taskId: string) => api.unlinkTaskFromJournal(year, date, taskId),
    onSuccess: (result) => {
      queryClient.setQueryData(['journalEntry', date], result);
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
    },
  });

  function invalidateEntry() {
    // Unlike saveMutation/linkMutation/unlinkMutation above, a revert
    // changes the file out from under us without handing back the new
    // entry shape — refetch rather than `setQueryData`.
    queryClient.invalidateQueries({ queryKey: ['journalEntry', date] });
    queryClient.invalidateQueries({ queryKey: ['journalYear', year] });
    queryClient.invalidateQueries({ queryKey: ['calendar'] });
  }

  const linkedTaskIds = entryQuery.data?.entry.frontmatter.linkedTasks ?? [];

  const tasksById = useMemo(() => {
    const map = new Map<string, LinkedTaskInfo>();
    for (const project of projectsQuery.data?.projects ?? []) {
      for (const task of project.tasks) {
        map.set(task.id, { id: task.id, title: task.text, projectColor: project.frontmatter.color });
      }
    }
    return map;
  }, [projectsQuery.data]);

  const searchResults: IndexedTask[] = (searchQuery.data?.tasks ?? []).filter((t) => !linkedTaskIds.includes(t.id));

  return (
    <div>
      <div className="journal-head">
        <button className="journal-nav-btn" onClick={() => navigate(`/journal/${yearOf(addDays(date, -1))}/${addDays(date, -1)}`)} title="Previous day">
          ‹
        </button>
        <h1 className="journal-date">{formatDateLong(date)}</h1>
        <button className="journal-nav-btn" onClick={() => navigate(`/journal/${yearOf(addDays(date, 1))}/${addDays(date, 1)}`)} title="Next day">
          ›
        </button>
      </div>
      <div className="page-sub">{date === todayStr() ? 'Today' : ''}</div>

      <div className="journal-tags">
        <TagInput value={tags} onChange={handleTagsChange} placeholder="Add tag…" />
      </div>

      <MarkdownTextarea
        className="journal-body"
        placeholder="Write about today…"
        value={body}
        onChange={(e) => handleBodyChange(e.target.value)}
        disabled={entryQuery.isLoading}
      />
      <div className="journal-save-status">
        {saveState === 'saving' && 'Saving…'}
        {saveState === 'saved' && 'Saved'}
      </div>

      <div className="linked-section">
        <div className="linked-title">Linked tasks</div>
        <div className="linked-wrap">
          {linkedTaskIds.map((taskId) => {
            const info = tasksById.get(taskId);
            return (
              <span className="linked-chip" key={taskId}>
                <span className="project-dot" style={{ background: info?.projectColor ?? 'var(--hairline)' }} />
                {info?.title ?? taskId}
                <button className="linked-remove" onClick={() => unlinkMutation.mutate(taskId)} aria-label="Remove link">
                  ×
                </button>
              </span>
            );
          })}
          <div className="picker-wrap">
            <button className="add-link-btn" onClick={() => setPickerOpen((v) => !v)}>
              + Add task
            </button>
            {pickerOpen && (
              <div className="picker-panel">
                <input
                  className="picker-input"
                  placeholder="Search tasks…"
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  autoFocus
                />
                {searchResults.map((t) => (
                  <button className="picker-item" key={t.id} onClick={() => linkMutation.mutate(t.id)}>
                    <span className="project-dot" style={{ background: t.projectColor }} />
                    {t.text}
                  </button>
                ))}
                {debouncedQuery.trim() && searchResults.length === 0 && <div className="picker-empty">No matching tasks.</div>}
              </div>
            )}
          </div>
        </div>
      </div>

      <HistoryPanel path={`journal/${year}/${date}.md`} onReverted={invalidateEntry} />
    </div>
  );
}
