import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import * as api from '../api/client';
import Modal from '../components/Modal';
import ProjectCard from '../components/ProjectCard';
import ProjectForm from '../components/ProjectForm';
import { usePinnedProjects } from '../lib/pins';

export default function ProjectsListPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['projects'], queryFn: api.listProjects });
  const { pinnedProjectSlugs, togglePinnedProject } = usePinnedProjects();
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [groupFilters, setGroupFilters] = useState<string[]>([]);

  function toggleGroupFilter(group: string) {
    setGroupFilters((current) => (current.includes(group) ? current.filter((g) => g !== group) : [...current, group]));
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
  const allGroups = [...new Set(projects.map((p) => p.frontmatter.group))].sort();
  // Matches a project in *any* of the selected groups (OR) — same
  // widening-not-narrowing reasoning the old tag filter used.
  const visible = projects
    .filter((p) => showArchived || !p.frontmatter.archived)
    .filter((p) => groupFilters.length === 0 || groupFilters.includes(p.frontmatter.group));

  // Organize the visible projects into their groups (PLAN.md "organize
  // projects into groups") — a section per group, alphabetical, each
  // rendering its own `.projects-list` exactly like the old flat list did.
  const groupSections = new Map<string, typeof visible>();
  for (const project of visible) {
    const group = project.frontmatter.group;
    const bucket = groupSections.get(group);
    if (bucket) bucket.push(project);
    else groupSections.set(group, [project]);
  }
  const sortedGroups = [...groupSections.keys()].sort();

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
            existingGroups={allGroups}
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

        {allGroups.length > 1 && (
          <div className="tag-filter-row">
            {allGroups.map((group) => (
              <button
                key={group}
                type="button"
                className={`tag-pill tag-pill-filter ${groupFilters.includes(group) ? 'active' : ''}`}
                onClick={() => toggleGroupFilter(group)}
              >
                {group}
              </button>
            ))}
            {groupFilters.length > 0 && (
              <button type="button" className="tag-filter-clear" onClick={() => setGroupFilters([])}>
                {t('projectsList.clear')}
              </button>
            )}
          </div>
        )}
      </div>

      {sortedGroups.map((group) => (
        <div className="projects-group-section" key={group}>
          <h2 className="projects-group-heading">{group}</h2>
          <div className="projects-list">
            {groupSections.get(group)!.map((project) => (
              <ProjectCard
                key={project.slug}
                project={project}
                pinned={pinnedProjectSlugs.includes(project.slug)}
                onTogglePin={() => togglePinnedProject(project.slug)}
              />
            ))}
          </div>
        </div>
      ))}
      {visible.length === 0 && <div className="empty-note">{t('projectsList.empty')}</div>}
    </div>
  );
}
