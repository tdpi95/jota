import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import * as api from '../api/client';
import Modal from '../components/Modal';
import ProjectCard from '../components/ProjectCard';
import ProjectForm from '../components/ProjectForm';

export default function ProjectsListPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['projects'], queryFn: api.listProjects });
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [tagFilters, setTagFilters] = useState<string[]>([]);

  function toggleTagFilter(tag: string) {
    setTagFilters((current) => (current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]));
  }

  const createMutation = useMutation({
    mutationFn: api.createProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setCreating(false);
    },
  });

  if (isLoading) return <p className="page-sub">{t('projectsList.loading')}</p>;
  if (isError) return <p className="field-error">{(error as Error).message}</p>;

  const projects = data?.projects ?? [];
  const allTags = [...new Set(projects.flatMap((p) => p.frontmatter.tags))].sort();
  // Matches a project tagged with *any* of the selected tags (OR) — narrowing
  // multi-tag filters to an AND match tends to go empty fast on a small,
  // sparsely-tagged project list; OR keeps adding a filter widening rather
  // than a likely dead end.
  const visible = projects
    .filter((p) => showArchived || !p.frontmatter.archived)
    .filter((p) => tagFilters.length === 0 || p.frontmatter.tags.some((t) => tagFilters.includes(t)));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('projectsList.title')}</h1>
          <div className="page-sub">{t('projectsList.projectCount', { count: visible.length })}</div>
        </div>
        <button className="page-action" onClick={() => setCreating(true)}>
          {t('projectsList.newProject')}
        </button>
      </div>

      {creating && (
        <Modal title={t('projectsList.newProjectModalTitle')} onClose={() => setCreating(false)}>
          <ProjectForm
            bare
            submitLabel={t('projectsList.createProject')}
            pending={createMutation.isPending}
            onSubmit={(values) => createMutation.mutate(values)}
            onCancel={() => setCreating(false)}
          />
        </Modal>
      )}

      <div className="projects-filters">
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink-muted)' }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} style={{ width: 'auto' }} />
          {t('projectsList.showArchived')}
        </label>

        {allTags.length > 0 && (
          <div className="tag-filter-row">
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={`tag-pill tag-pill-filter ${tagFilters.includes(tag) ? 'active' : ''}`}
                onClick={() => toggleTagFilter(tag)}
              >
                {tag}
              </button>
            ))}
            {tagFilters.length > 0 && (
              <button type="button" className="tag-filter-clear" onClick={() => setTagFilters([])}>
                {t('projectsList.clear')}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="projects-list">
        {visible.map((project) => (
          <ProjectCard key={project.slug} project={project} />
        ))}
        {visible.length === 0 && <div className="empty-note">{t('projectsList.empty')}</div>}
      </div>
    </div>
  );
}
