import { Link } from 'react-router-dom';

import type { ProjectSummary } from '../types';

/**
 * One project's summary: color, name, description preview, tags, and
 * per-status task counts. Links to `/projects/:slug`.
 *
 * `variant="row"` (default) is the full-width list row used on `/projects`.
 * `variant="grid"` is a compact vertical card for the Dashboard's "Recent
 * projects" section (milestone 18) — laid out in a 3-column grid there
 * specifically so it doesn't read as just another task row.
 */
export default function ProjectCard({ project, variant = 'row' }: { project: ProjectSummary; variant?: 'row' | 'grid' }) {
  const { slug, frontmatter, tasks } = project;
  const todoCount = tasks.filter((t) => t.status === 'todo').length;
  const doingCount = tasks.filter((t) => t.status === 'doing').length;
  const doneCount = tasks.filter((t) => t.status === 'done').length;

  const counts = (
    <div className="project-counts">
      <span>
        <b>{todoCount}</b> todo
      </span>
      <span>
        <b>{doingCount}</b> doing
      </span>
      <span>
        <b>{doneCount}</b> done
      </span>
    </div>
  );

  const tagPills = frontmatter.tags.length > 0 && (
    <div className="project-tags">
      {frontmatter.tags.map((tag) => (
        <span className="tag-pill" key={tag}>
          {tag}
        </span>
      ))}
    </div>
  );

  if (variant === 'grid') {
    return (
      <Link className="project-card-grid" to={`/projects/${slug}`}>
        <div className="project-card-head">
          <span className="project-color-tab" style={{ background: frontmatter.color }} />
          <span className={`project-name ${frontmatter.archived ? 'archived' : ''}`}>
            {frontmatter.name}
            {frontmatter.archived ? ' (archived)' : ''}
          </span>
        </div>
        {frontmatter.description && <span className="project-desc project-desc-clamp">{frontmatter.description}</span>}
        {tagPills}
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
          {frontmatter.archived ? ' (archived)' : ''}
        </span>
        {frontmatter.description && <span className="project-desc">{frontmatter.description}</span>}
      </div>
      {tagPills}
      {counts}
    </Link>
  );
}
