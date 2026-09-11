import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';

import * as api from '../api/client';
import { formatDateLong, todayStr } from '../lib/date';

export default function JournalYearPage() {
  const { year: yearParam } = useParams();
  const navigate = useNavigate();
  const year = yearParam ?? todayStr().slice(0, 4);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['journalYear', year],
    queryFn: () => api.listJournalYear(year),
  });

  const entries = [...(data?.entries ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Journal</h1>
          <div className="page-sub">{year}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="journal-nav-btn" onClick={() => navigate(`/journal/${Number(year) - 1}`)} title="Previous year">
            ‹
          </button>
          <button className="journal-nav-btn" onClick={() => navigate(`/journal/${Number(year) + 1}`)} title="Next year">
            ›
          </button>
          <Link className="page-action" to={`/journal/${todayStr().slice(0, 4)}/${todayStr()}`}>
            Today's entry
          </Link>
        </div>
      </div>

      {isLoading && <p className="page-sub">Loading…</p>}
      {isError && <p className="field-error">{(error as Error).message}</p>}

      <div className="journal-year-list">
        {entries.map((entry) => (
          <Link className={`journal-year-row ${entry.hasBody ? 'has-body' : ''}`} to={`/journal/${entry.date.slice(0, 4)}/${entry.date}`} key={entry.date}>
            <span className="empty-dot" title={entry.hasBody ? 'Has an entry' : 'Empty'} />
            <span className="date">{formatDateLong(entry.date)}</span>
            <div className="project-tags">
              {entry.tags.map((tag) => (
                <span className="tag-pill" key={tag}>
                  {tag}
                </span>
              ))}
            </div>
          </Link>
        ))}
        {!isLoading && entries.length === 0 && <div className="empty-note">No journal entries yet in {year}.</div>}
      </div>
    </div>
  );
}
