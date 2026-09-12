import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import * as api from '../api/client';
import { formatDateLong, monthShortLabel, todayStr } from '../lib/date';
import type { CalendarDay, CalendarTaskMark } from '../types';

type ViewMode = 'due' | 'journal';
type Granularity = 'month' | 'year';

interface Cell {
  key: string;
  blank: boolean;
  date?: string;
  label?: string;
  isToday?: boolean;
  hasJournalEntry?: boolean;
  tasks?: CalendarTaskMark[];
}

interface YearDayCell {
  key: string;
  blank: boolean;
  label?: string;
  isToday?: boolean;
  hasJournalEntry?: boolean;
}

const VISIBLE_TASKS_PER_DAY = 4;

// Icons for the due-date/journal-log toggle buttons — the journal one
// reuses AppShell's own "journal" nav icon path so the same metaphor (a
// notebook) means the same thing in both places.
const MODE_ICONS: Record<ViewMode, React.ReactNode> = {
  due: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  ),
  journal: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  ),
};

/** Plain day cells for one month of the year overview — no task data at all
 * (deliberately: it's a lightweight month picker, not another place to read
 * task state), padded to a fixed 6 rows so all 12 mini-months in the grid
 * line up at the same height. `journalDates` (every date in the year with a
 * non-empty journal entry, from the single `GET /api/journal/:year` call —
 * much cheaper than the month view's per-month due/linked-task query) marks
 * the same days the month view highlights, just without task detail. */
function buildYearMonthCells(year: number, month: number, today: string, journalDates: Set<string>): YearDayCell[] {
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: YearDayCell[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push({ key: `lead-${i}`, blank: true });
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ key: date, blank: false, label: String(d), isToday: date === today, hasJournalEntry: journalDates.has(date) });
  }
  while (cells.length < 42) cells.push({ key: `trail-${cells.length}`, blank: true });
  return cells;
}

/**
 * Full-page month calendar (as opposed to `CalendarSidebar`'s compact dots):
 * every day cell lists the actual task titles for that day, backed by the
 * same `GET /api/calendar/:year/:month` aggregate the sidebar uses. A
 * due/journal toggle picks which of a `CalendarTaskMark`'s two possible
 * reasons buckets a task under a given day — 'due' (the task's own due
 * date) or 'linked' (the day it was logged onto via a journal entry) — a
 * task can appear under different days for each, never both on the same
 * page. The journal-entry highlight (independent of the toggle) still marks
 * any day with a non-empty journal entry either way. Clicking a day number
 * navigates to that journal day (matching the sidebar); clicking a task
 * navigates to its owning project, where the task itself lives and is
 * edited.
 *
 * Clicking the month/year label switches to a year overview (`granularity`)
 * — 12 plain month grids for the year, deliberately carrying no task detail
 * (it's a fast way to jump to a month, not another place to read task
 * state) but still highlighting journal-entry days via one cheap year-wide
 * `GET /api/journal/:year` call, separate from the month view's heavier
 * per-month due/linked-task query (see the two `enabled` guards below).
 * Clicking a month there returns to the month view on that month.
 */
export default function CalendarPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.language === 'vi' ? 'vi' : 'en';
  const weekdayLabels = t('calendarPage.weekdayLabels', { returnObjects: true }) as string[];
  const today = todayStr();

  const [view, setView] = useState(() => ({
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)) - 1, // 0-based
  }));
  const [mode, setMode] = useState<ViewMode>('due');
  const [granularity, setGranularity] = useState<Granularity>('month');
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({});

  const yearStr = String(view.year);
  const monthStr = String(view.month + 1).padStart(2, '0');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['calendar', yearStr, monthStr],
    queryFn: () => api.getCalendarMonth(yearStr, monthStr),
    enabled: granularity === 'month',
  });
  const daysByDate = new Map((data?.days ?? []).map((d: CalendarDay) => [d.date, d]));

  // Year overview's journal highlight: one cheap year-wide call (already
  // used by JournalYearPage) rather than 12 of the month view's heavier
  // due/linked-task queries — only fetched while actually viewing the year
  // grid.
  const { data: journalYearData } = useQuery({
    queryKey: ['journalYear', yearStr],
    queryFn: () => api.listJournalYear(yearStr),
    enabled: granularity === 'year',
  });
  const journalDates = new Set((journalYearData?.entries ?? []).filter((e) => e.hasBody).map((e) => e.date));

  function shiftMonth(delta: number) {
    setView((v) => {
      let month = v.month + delta;
      let year = v.year;
      if (month < 0) {
        month = 11;
        year -= 1;
      } else if (month > 11) {
        month = 0;
        year += 1;
      }
      return { year, month };
    });
  }

  function shiftYear(delta: number) {
    setView((v) => ({ ...v, year: v.year + delta }));
  }

  function goToToday() {
    setGranularity('month');
    setView({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 });
  }

  // `mode` is the toggle's own vocabulary ('due'/'journal'); a mark's
  // `reason` (PLAN.md's CalendarTaskMark) is 'due'/'linked' — 'linked'
  // meaning "that day's journal entry links to this task", i.e. the day it
  // was logged.
  const reasonForMode: Record<ViewMode, CalendarTaskMark['reason']> = { due: 'due', journal: 'linked' };

  const firstWeekday = new Date(view.year, view.month, 1).getDay();
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();

  const cells: Cell[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push({ key: `lead-${i}`, blank: true });
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${yearStr}-${monthStr}-${String(d).padStart(2, '0')}`;
    const day = daysByDate.get(date);
    cells.push({
      key: date,
      blank: false,
      date,
      label: String(d),
      isToday: date === today,
      hasJournalEntry: day?.hasJournalEntry ?? false,
      tasks: (day?.tasks ?? []).filter((mark) => mark.reason === reasonForMode[mode]),
    });
  }
  while (cells.length % 7 !== 0) cells.push({ key: `trail-${cells.length}`, blank: true });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('calendarPage.title')}</h1>
          <div className="page-sub">{granularity === 'year' ? t('calendarPage.pickMonth') : t(`calendarPage.mode.${mode}Hint`)}</div>
        </div>
        {granularity === 'month' && (
          <div className="cp-view-toggle" role="radiogroup" aria-label={t('calendarPage.mode.sectionTitle') ?? undefined}>
            {(['due', 'journal'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                className={`ws-row-btn cp-mode-btn ${mode === m ? 'is-active' : ''}`}
                onClick={() => setMode(m)}
              >
                {MODE_ICONS[m]}
                {t(`calendarPage.mode.${m}`)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="cp-header">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => (granularity === 'year' ? shiftYear(-1) : shiftMonth(-1))}
          title={granularity === 'year' ? t('calendarPage.previousYear') : t('calendarSidebar.previousMonth')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <button
          type="button"
          className="cp-label"
          onClick={() => setGranularity(granularity === 'year' ? 'month' : 'year')}
          title={t('calendarPage.yearOverview') ?? undefined}
        >
          {granularity === 'year' ? view.year : `${monthShortLabel(view.month, language)} ${view.year}`}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => (granularity === 'year' ? shiftYear(1) : shiftMonth(1))}
          title={granularity === 'year' ? t('calendarPage.nextYear') : t('calendarSidebar.nextMonth')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
        <button type="button" className="btn-secondary cp-today-btn" onClick={goToToday}>
          {t('calendarPage.today')}
        </button>
      </div>

      {granularity === 'year' && (
        <div className="cp-year-grid">
          {Array.from({ length: 12 }, (_, m) => m).map((m) => (
            <div key={m} className="cp-year-month">
              <button
                type="button"
                className="cp-year-month-head"
                onClick={() => {
                  setView({ year: view.year, month: m });
                  setGranularity('month');
                }}
              >
                {monthShortLabel(m, language)}
              </button>
              <div className="cp-year-weekdays">
                {weekdayLabels.map((label, i) => (
                  <span key={i}>{label}</span>
                ))}
              </div>
              <div className="cp-year-days">
                {buildYearMonthCells(view.year, m, today, journalDates).map((c) => (
                  <span
                    key={c.key}
                    className={`cp-year-day ${c.blank ? 'blank' : ''} ${c.hasJournalEntry ? 'has-journal' : ''} ${c.isToday ? 'today' : ''}`}
                  >
                    {!c.blank && c.label}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {granularity === 'month' && isLoading && <p className="page-sub">{t('calendarPage.loading')}</p>}
      {granularity === 'month' && isError && <p className="field-error">{t('calendarPage.failedToLoad')}</p>}

      {granularity === 'month' && !isLoading && !isError && (
        <>
          <div className="cp-weekdays">
            {weekdayLabels.map((label, i) => (
              <span key={i}>{label}</span>
            ))}
          </div>
          <div className="cp-grid">
            {cells.map((cell) => {
              if (cell.blank) return <div key={cell.key} className="cp-day blank" />;
              const tasks = cell.tasks ?? [];
              const expanded = expandedDays[cell.date!] ?? false;
              const visibleTasks = expanded ? tasks : tasks.slice(0, VISIBLE_TASKS_PER_DAY);
              const hiddenCount = tasks.length - visibleTasks.length;
              return (
                <div key={cell.key} className={`cp-day ${cell.isToday ? 'today' : ''} ${cell.hasJournalEntry ? 'has-journal' : ''}`}>
                  <div className="cp-day-head">
                    <Link
                      className="cp-day-num"
                      to={`/journal/${cell.date!.slice(0, 4)}/${cell.date}`}
                      title={t('calendarPage.openJournalEntry', { date: formatDateLong(cell.date!, language) }) ?? undefined}
                    >
                      {cell.label}
                    </Link>
                  </div>
                  <div className="cp-tasks">
                    {visibleTasks.map((mark) => (
                      <Link
                        key={mark.taskId}
                        to={`/projects/${mark.projectSlug}`}
                        className={`cp-task ${mark.status === 'done' ? 'done' : ''}`}
                        title={mark.text}
                      >
                        <span className="cp-task-dot" style={{ background: mark.projectColor }} />
                        <span className="cp-task-text">{mark.text}</span>
                      </Link>
                    ))}
                    {hiddenCount > 0 && (
                      <button type="button" className="cp-more-btn" onClick={() => setExpandedDays((m) => ({ ...m, [cell.date!]: true }))}>
                        {t('calendarPage.showMore', { count: hiddenCount })}
                      </button>
                    )}
                    {expanded && tasks.length > VISIBLE_TASKS_PER_DAY && (
                      <button type="button" className="cp-more-btn" onClick={() => setExpandedDays((m) => ({ ...m, [cell.date!]: false }))}>
                        {t('calendarPage.showFewer')}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
