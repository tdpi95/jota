import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import type { ProjectSummary } from '../types';

/**
 * One project's summary: color, name, description preview, and per-status
 * task counts. Links to `/projects/:slug`. The project's group isn't shown
 * on the card itself — `/projects` renders it as a section heading instead
 * (see ProjectsListPage), and the Dashboard's "Recent projects" grid omits
 * it entirely as not relevant there.
 *
 * `variant="row"` (default) is the full-width list row used on `/projects`.
 * `variant="grid"` is a compact vertical card for the Dashboard's "Recent
 * projects" section (milestone 18) — laid out in a 3-column grid there
 * specifically so it doesn't read as just another task row.
 */
export default function ProjectCard({ project, variant = 'row' }: { project: ProjectSummary; variant?: 'row' | 'grid' }) {
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

  if (variant === 'grid') {
    return (
      <Link className="project-card-grid" to={`/projects/${slug}`}>
        <div className="project-card-head">
          <span className="project-color-tab" style={{ background: frontmatter.color }} />
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
      <span className="project-color-tab" style={{ background: frontmatter.color }} />
      <div className="project-row-main">
        <span className={`project-name ${frontmatter.archived ? 'archived' : ''}`}>
          {frontmatter.name}
          {frontmatter.archived ? t('projectCard.archivedSuffix') : ''}
        </span>
        {frontmatter.description && <span className="project-desc">{frontmatter.description}</span>}
      </div>
      {counts}
    </Link>
  );
}
