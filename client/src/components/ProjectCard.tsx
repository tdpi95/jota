import { Link } from 'react-router-dom';

import type { ProjectSummary } from '../types';

/** One row in the projects list (`/projects`): color tab, name, description
 * preview, tags, and per-status task counts. Links to `/projects/:slug`. */
export default function ProjectCard({ project }: { project: ProjectSummary }) {
  const { slug, frontmatter, tasks } = project;
  const todoCount = tasks.filter((t) => t.status === 'todo').length;
  const doingCount = tasks.filter((t) => t.status === 'doing').length;
  const doneCount = tasks.filter((t) => t.status === 'done').length;

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
      <div className="project-tags">
        {frontmatter.tags.map((tag) => (
          <span className="tag-pill" key={tag}>
            {tag}
          </span>
        ))}
      </div>
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
    </Link>
  );
}
