import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import type { ProjectSummary } from '../types';
import PinButton from './PinButton';

/**
 * One project's summary: color, name, description preview, and per-status
 * task counts. Links to `/projects/:slug`. The project's group isn't shown
 * on the card itself — `/projects` renders it as a section heading instead
 * (see ProjectsListPage), and the Dashboard's "Pinned" grid omits it
 * entirely as not relevant there.
 *
 * `variant="row"` (default) is the full-width list row used on `/projects`.
 * `variant="grid"` is a compact vertical card for the Dashboard's "Pinned"
 * section (formerly "Recent projects", milestone 18) — laid out in a
 * 3-column grid there specifically so it doesn't read as just another task
 * row.
 *
 * `pinned`/`onTogglePin` are both optional — every current caller
 * (`ProjectsListPage`, `DashboardPage`) passes them via `lib/pins.ts`'s
 * `usePinnedProjects`, but the card itself doesn't require pinning to be
 * meaningful, so a future caller can render it without a pin button at all.
 */
export default function ProjectCard({
  project,
  variant = 'row',
  pinned,
  onTogglePin,
}: {
  project: ProjectSummary;
  variant?: 'row' | 'grid';
  pinned?: boolean;
  onTogglePin?: () => void;
}) {
  const { t } = useTranslation();
  const { slug, frontmatter, tasks } = project;
  const todoCount = tasks.filter((task) => task.status === 'todo').length;
  const doingCount = tasks.filter((task) => task.status === 'doing').length;
  const doneCount = tasks.filter((task) => task.status === 'done').length;

  const counts = (
    <div className="project-counts">
      <span>
        <b>{todoCount}</b> {t('projectCard.todo')}
      </span>
      <span>
        <b>{doingCount}</b> {t('projectCard.doing')}
      </span>
      <span>
        <b>{doneCount}</b> {t('projectCard.done')}
      </span>
    </div>
  );

  const avatar = frontmatter.profileImage ? (
    <span className="project-avatar-wrap">
      <img className="project-avatar-tab" src={`/api/${frontmatter.profileImage}`} alt="" />
      <span className="project-color-badge" style={{ background: frontmatter.color }} />
    </span>
  ) : (
    <span className="project-color-tab" style={{ background: frontmatter.color }} />
  );

  if (variant === 'grid') {
    return (
      <Link className="project-card-grid" to={`/projects/${slug}`}>
        {onTogglePin && <PinButton pinned={!!pinned} onToggle={onTogglePin} className="pin-btn-grid" />}
        <div className="project-card-head">
          {avatar}
          <span className={`project-name ${frontmatter.archived ? 'archived' : ''}`}>
            {frontmatter.name}
            {frontmatter.archived ? t('projectCard.archivedSuffix') : ''}
          </span>
        </div>
        {frontmatter.description && <span className="project-desc project-desc-clamp">{frontmatter.description}</span>}
        {counts}
      </Link>
    );
  }

  return (
    <Link className="project-row" to={`/projects/${slug}`}>
      {avatar}
      <div className="project-row-main">
        <span className={`project-name ${frontmatter.archived ? 'archived' : ''}`}>
          {frontmatter.name}
          {frontmatter.archived ? t('projectCard.archivedSuffix') : ''}
        </span>
        {frontmatter.description && <span className="project-desc">{frontmatter.description}</span>}
      </div>
      {counts}
      {onTogglePin && <PinButton pinned={!!pinned} onToggle={onTogglePin} />}
    </Link>
  );
}
