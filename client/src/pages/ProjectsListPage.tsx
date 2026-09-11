import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import * as api from '../api/client';
import ProjectCard from '../components/ProjectCard';
import ProjectForm from '../components/ProjectForm';

export default function ProjectsListPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['projects'], queryFn: api.listProjects });
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const createMutation = useMutation({
    mutationFn: api.createProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setCreating(false);
    },
  });

  if (isLoading) return <p className="page-sub">Loading projects…</p>;
  if (isError) return <p className="field-error">{(error as Error).message}</p>;

  const projects = data?.projects ?? [];
  const visible = showArchived ? projects : projects.filter((p) => !p.frontmatter.archived);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Projects</h1>
          <div className="page-sub">{visible.length} projects</div>
        </div>
        <button className="page-action" onClick={() => setCreating((v) => !v)}>
          {creating ? 'Cancel' : '+ New project'}
        </button>
      </div>

      {creating && (
        <ProjectForm
          submitLabel="Create project"
          pending={createMutation.isPending}
          onSubmit={(values) => createMutation.mutate(values)}
          onCancel={() => setCreating(false)}
        />
      )}

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink-muted)', marginBottom: 14 }}>
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} style={{ width: 'auto' }} />
        Show archived
      </label>

      <div className="projects-list">
        {visible.map((project) => (
          <ProjectCard key={project.slug} project={project} />
        ))}
        {visible.length === 0 && <div className="empty-note">No projects yet — create one to get started.</div>}
      </div>
    </div>
  );
}
