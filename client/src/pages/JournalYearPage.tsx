import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';

import * as api from '../api/client';
import { formatDateLong, todayStr } from '../lib/date';

export default function JournalYearPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.language === 'vi' ? 'vi' : 'en';
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
          <h1 className="page-title">{t('journalYear.title')}</h1>
          <div className="page-sub">{year}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="journal-nav-btn" onClick={() => navigate(`/journal/${Number(year) - 1}`)} title={t('journalYear.previousYear')}>
            ‹
          </button>
          <button className="journal-nav-btn" onClick={() => navigate(`/journal/${Number(year) + 1}`)} title={t('journalYear.nextYear')}>
            ›
          </button>
          <Link className="page-action" to={`/journal/${todayStr().slice(0, 4)}/${todayStr()}`}>
            {t('journalYear.todaysEntry')}
          </Link>
        </div>
      </div>

      {isLoading && <p className="page-sub">{t('journalYear.loading')}</p>}
      {isError && <p className="field-error">{(error as Error).message}</p>}

      <div className="journal-year-list">
        {entries.map((entry) => (
          <Link className={`journal-year-row ${entry.hasBody ? 'has-body' : ''}`} to={`/journal/${entry.date.slice(0, 4)}/${entry.date}`} key={entry.date}>
            <span className="empty-dot" title={entry.hasBody ? t('journalYear.hasEntry') : t('journalYear.empty')} />
            <span className="date">{formatDateLong(entry.date, language)}</span>
            <div className="project-tags">
              {entry.tags.map((tag) => (
                <span className="tag-pill" key={tag}>
                  {tag}
                </span>
              ))}
            </div>
          </Link>
        ))}
        {!isLoading && entries.length === 0 && <div className="empty-note">{t('journalYear.noEntries', { year })}</div>}
      </div>
    </div>
  );
}
