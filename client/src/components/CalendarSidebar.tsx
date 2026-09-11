import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';

import * as api from '../api/client';
import { monthShortLabel, todayStr } from '../lib/date';

interface Cell {
  key: string;
  blank: boolean;
  date?: string;
  label?: string;
  isToday?: boolean;
  isSelected?: boolean;
  hasJournalEntry?: boolean;
  dotColors?: string[];
}

/**
 * Persistent sidebar month grid (PLAN.md `AppShell`'s `CalendarSidebar`):
 * marks days with a journal entry (a dot) and colored dots per
 * due/linked task (by project color), backed by
 * `GET /api/calendar/:year/:month`. Clicking a day navigates to
 * `/journal/:year/:date`. The viewed month is local state (defaults to the
 * current month) — independent of whatever page is currently routed to, so
 * browsing the calendar doesn't fight with journal day navigation; the
 * *selected* day (highlighted) is read back out of the current route
 * instead of tracked separately, so the two stay in sync automatically.
 */
export default function CalendarSidebar() {
  const { t, i18n } = useTranslation();
  const language = i18n.language === 'vi' ? 'vi' : 'en';
  const weekdayLabels = t('calendarSidebar.weekdayLabels', { returnObjects: true }) as string[];
  const navigate = useNavigate();
  const location = useLocation();
  const today = todayStr();

  const [view, setView] = useState(() => ({
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)) - 1, // 0-based
  }));

  const yearStr = String(view.year);
  const monthStr = String(view.month + 1).padStart(2, '0');

  const { data } = useQuery({
    queryKey: ['calendar', yearStr, monthStr],
    queryFn: () => api.getCalendarMonth(yearStr, monthStr),
  });
  const daysByDate = new Map((data?.days ?? []).map((d) => [d.date, d]));

  const journalMatch = matchPath('/journal/:year/:date', location.pathname);
  const selectedDate = journalMatch?.params.date;

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
      isSelected: date === selectedDate,
      hasJournalEntry: day?.hasJournalEntry ?? false,
      // Dedup by color (a project can have multiple tasks marked the same
      // day) and cap at 3 dots — matches design/Main.dc.html.
      dotColors: [...new Set((day?.tasks ?? []).map((t) => t.projectColor))].slice(0, 3),
    });
  }
  while (cells.length % 7 !== 0) cells.push({ key: `trail-${cells.length}`, blank: true });

  return (
    <div className="calendar">
      <div className="cal-header">
        <button onClick={() => shiftMonth(-1)} title={t('calendarSidebar.previousMonth')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <span className="cal-label">
          {monthShortLabel(view.month, language)} {view.year}
        </span>
        <button onClick={() => shiftMonth(1)} title={t('calendarSidebar.nextMonth')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>
      <div className="cal-weekdays">
        {weekdayLabels.map((label, i) => (
          <span key={i}>{label}</span>
        ))}
      </div>
      <div className="cal-grid">
        {cells.map((cell) => (
          <button
            key={cell.key}
            className={`cal-day ${cell.blank ? 'blank' : cell.isToday ? 'today' : cell.isSelected ? 'selected' : ''}`}
            disabled={cell.blank}
            onClick={() => cell.date && navigate(`/journal/${cell.date.slice(0, 4)}/${cell.date}`)}
            title={cell.date}
          >
            {!cell.blank && (
              <>
                <span>{cell.label}</span>
                <span className="cal-dots">
                  {cell.hasJournalEntry && <span className="cal-dot journal" />}
                  {cell.dotColors?.map((color, i) => (
                    <span className="cal-dot" style={{ background: color }} key={i} />
                  ))}
                </span>
              </>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
