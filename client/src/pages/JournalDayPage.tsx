import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import * as api from '../api/client';
import AttachmentField, { useAttachmentField } from '../components/AttachmentField';
import HistoryPanel from '../components/HistoryPanel';
import MarkdownEditor from '../components/MarkdownEditor';
import TagInput from '../components/TagInput';
import { addDays, formatDateLong, todayStr, yearOf } from '../lib/date';
import type { IndexedTask } from '../types';

// Every autosave is also a git commit (PLAN.md: every write is committed,
// that's the undo mechanism) — a short delay fires on almost every normal
// mid-sentence thinking pause while journaling, producing a commit per
// pause. User-configurable via Settings (`autosaveIntervalPreference`
// below), defaulting to 30s server-side; this is only the value shown
// before that preference has loaded, so it must match that default exactly
// or the debounce would visibly jump once the real value arrives. The
// unmount-flush effect below still saves immediately on navigate-away
// regardless of this delay, so nothing is lost by waiting longer here.
const DEFAULT_AUTOSAVE_DELAY_MS = 30_000;
const SEARCH_DEBOUNCE_MS = 300;

interface LinkedTaskInfo {
  id: string;
  title: string;
  projectColor: string;
  projectSlug: string;
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
  const { t, i18n } = useTranslation();
  const language = i18n.language === 'vi' ? 'vi' : 'en';
  const year = yearOf(date);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const entryQuery = useQuery({ queryKey: ['journalEntry', date], queryFn: () => api.getJournalEntry(year, date) });
  // Settings-configurable (`SettingsPage`'s Autosave section) — read fresh
  // on every mount rather than bootstrapped app-wide like theme/language,
  // since this only affects a debounce timer, not anything rendered before
  // this page exists. Kept in a ref (not state) purely so `scheduleSave`
  // below always reads the latest value without needing to be redefined
  // (and its pending `setTimeout` rescheduled) every time the query resolves.
  const autosaveIntervalQuery = useQuery({ queryKey: ['autosaveIntervalPreference'], queryFn: api.getAutosaveIntervalPreference });
  const autosaveDelayMsRef = useRef(DEFAULT_AUTOSAVE_DELAY_MS);
  autosaveDelayMsRef.current = autosaveIntervalQuery.data ? autosaveIntervalQuery.data.autosaveIntervalSeconds * 1000 : DEFAULT_AUTOSAVE_DELAY_MS;
  // All projects (with their tasks embedded) — read directly from the
  // project files, not the index, so linked-task chip titles/colors are
  // never stale (PLAN.md "which reads go where"). There's no standalone
  // "get task by id" endpoint, so this doubles as that lookup.
  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: api.listProjects });

  const [body, setBody] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  // 'unsaved' (waiting out the debounce) is distinct from 'saving' (the PUT
  // is actually in flight) — the debounce timer resets on every keystroke,
  // so while actively composing with pauses shorter than the configured
  // interval it never fires at all; labeling that whole stretch "Saving…"
  // read as permanently stuck once the interval grew past a couple of
  // seconds, even though nothing had actually started saving yet.
  const [saveState, setSaveState] = useState<'idle' | 'unsaved' | 'saving' | 'saved'>('idle');
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
    setSaveState('unsaved');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      dirtyRef.current = false;
      setSaveState('saving');
      saveMutation.mutate({ body: nextBody, tags: nextTags });
    }, autosaveDelayMsRef.current);
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
        map.set(task.id, { id: task.id, title: task.text, projectColor: project.frontmatter.color, projectSlug: project.slug });
      }
    }
    return map;
  }, [projectsQuery.data]);

  // Title-only view of tasksById for HistoryPanel's commit-message display.
  const taskTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const [id, info] of tasksById) map.set(id, info.title);
    return map;
  }, [tasksById]);

  const searchResults: IndexedTask[] = (searchQuery.data?.tasks ?? []).filter((task) => !linkedTaskIds.includes(task.id));

  const attachmentState = useAttachmentField('journal', body, handleBodyChange);

  return (
    <div>
      <div className="journal-head">
        <button className="journal-nav-btn" onClick={() => navigate(`/journal/${yearOf(addDays(date, -1))}/${addDays(date, -1)}`)} title={t('journalDay.previousDay')}>
          ‹
        </button>
        <h1 className="journal-date">{formatDateLong(date, language)}</h1>
        <button className="journal-nav-btn" onClick={() => navigate(`/journal/${yearOf(addDays(date, 1))}/${addDays(date, 1)}`)} title={t('journalDay.nextDay')}>
          ›
        </button>
      </div>
      <div className="page-sub">{date === todayStr() ? t('journalDay.today') : ''}</div>

      <div className="journal-tags">
        <TagInput value={tags} onChange={handleTagsChange} placeholder={t('journalDay.tagPlaceholder')} />
      </div>

      <MarkdownEditor
        className="journal-body"
        placeholder={t('journalDay.bodyPlaceholder')}
        value={body}
        onChange={handleBodyChange}
        onPasteFiles={attachmentState.handleFiles}
        disabled={entryQuery.isLoading}
      />
      <AttachmentField state={attachmentState} disabled={entryQuery.isLoading} />
      <div className="journal-save-status">
        {saveState === 'unsaved' && t('journalDay.unsaved')}
        {saveState === 'saving' && t('journalDay.saving')}
        {saveState === 'saved' && t('journalDay.saved')}
      </div>

      <div className="linked-section">
        <div className="linked-title">{t('journalDay.linkedTasks')}</div>
        <div className="linked-wrap">
          {linkedTaskIds.map((taskId) => {
            const info = tasksById.get(taskId);
            return (
              <span className="linked-chip" key={taskId}>
                <span className="project-dot" style={{ background: info?.projectColor ?? 'var(--hairline)' }} />
                {info ? (
                  <button
                    type="button"
                    className="linked-chip-title"
                    onClick={() => navigate(`/projects/${info.projectSlug}`, { state: { highlightTaskId: taskId } })}
                  >
                    {info.title}
                  </button>
                ) : (
                  taskId
                )}
                <button className="linked-remove" onClick={() => unlinkMutation.mutate(taskId)} aria-label={t('journalDay.removeLink')}>
                  ×
                </button>
              </span>
            );
          })}
          <div className="picker-wrap">
            <button className="add-link-btn" onClick={() => setPickerOpen((v) => !v)}>
              {t('journalDay.addTask')}
            </button>
            {pickerOpen && (
              <div className="picker-panel">
                <input
                  className="picker-input"
                  placeholder={t('journalDay.searchPlaceholder')}
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  autoFocus
                />
                {searchResults.map((task) => (
                  <button className="picker-item" key={task.id} onClick={() => linkMutation.mutate(task.id)}>
                    <span className="project-dot" style={{ background: task.projectColor }} />
                    {task.text}
                  </button>
                ))}
                {debouncedQuery.trim() && searchResults.length === 0 && <div className="picker-empty">{t('journalDay.noMatchingTasks')}</div>}
              </div>
            )}
          </div>
        </div>
      </div>

      <HistoryPanel path={`journal/${year}/${date}.md`} onReverted={invalidateEntry} taskTitles={taskTitles} />
    </div>
  );
}
