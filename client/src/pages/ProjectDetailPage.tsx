import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import * as api from '../api/client';
import HistoryPanel from '../components/HistoryPanel';
import ProjectForm from '../components/ProjectForm';
import TaskForm from '../components/TaskForm';
import TaskRow from '../components/TaskRow';
import { todayStr, yearOf } from '../lib/date';
import type { Task, TaskStatus } from '../types';

const COLUMNS: { status: TaskStatus; title: string }[] = [
  { status: 'todo', title: 'Todo' },
  { status: 'doing', title: 'Doing' },
  { status: 'done', title: 'Done' },
];

export default function ProjectDetailPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['project', slug],
    queryFn: () => api.getProject(slug),
  });

  function invalidateProject() {
    queryClient.invalidateQueries({ queryKey: ['project', slug] });
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    queryClient.invalidateQueries({ queryKey: ['tasks', 'open'] });
    // Task due dates feed the calendar sidebar's dots — keep it in sync
    // with create/edit/delete here too, not just Dashboard's own mutations.
    queryClient.invalidateQueries({ queryKey: ['calendar'] });
  }

  const updateProjectMutation = useMutation({
    mutationFn: (values: api.UpdateProjectInput) => api.updateProject(slug, values),
    onSuccess: () => {
      invalidateProject();
      setEditing(false);
    },
  });

  const createTaskMutation = useMutation({
    mutationFn: (values: api.CreateTaskInput) => api.createTask(slug, values),
    onSuccess: invalidateProject,
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ taskId, values }: { taskId: string; values: api.UpdateTaskInput }) => api.updateTask(slug, taskId, values),
    onSuccess: invalidateProject,
  });

  const deleteTaskMutation = useMutation({
    mutationFn: (taskId: string) => api.deleteTask(slug, taskId),
    onSuccess: invalidateProject,
  });

  const logTodayMutation = useMutation({
    mutationFn: (taskId: string) => {
      const today = todayStr();
      return api.linkTaskToJournal(yearOf(today), today, taskId);
    },
    onSuccess: () => {
      const today = todayStr();
      queryClient.invalidateQueries({ queryKey: ['journalEntry', today] });
      queryClient.invalidateQueries({ queryKey: ['journalYear', yearOf(today)] });
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
    },
  });

  if (isLoading) return <p className="page-sub">Loading project…</p>;
  if (isError) {
    const message = error instanceof api.ApiError ? error.message : 'Failed to load project.';
    return (
      <div>
        <p className="field-error">{message}</p>
        <button className="btn-secondary" onClick={() => navigate('/projects')}>
          Back to projects
        </button>
      </div>
    );
  }

  // Belt-and-suspenders: isLoading/isError above cover every query state
  // that matters, but don't let a gap in that reasoning (or a future change
  // to the query's options) crash the page — fall back to the same "not
  // found" affordance rather than reading `.project` off `undefined`.
  if (!data) return <p className="page-sub">Loading project…</p>;

  const project = data.project;
  const { frontmatter, tasks } = project;
  const byStatus = (status: TaskStatus): Task[] => tasks.filter((t) => t.status === status);

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="pd-head">
            <span className="pd-color" style={{ background: frontmatter.color }} />
            <div>
              <h1 className="page-title">
                {frontmatter.name}
                {frontmatter.archived ? ' (archived)' : ''}
              </h1>
              <div className="pd-tags">
                {frontmatter.tags.map((tag) => (
                  <span className="tag-pill" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
        <button className="btn-secondary" onClick={() => setEditing((v) => !v)}>
          {editing ? 'Cancel' : 'Edit project'}
        </button>
      </div>

      {editing ? (
        <ProjectForm
          initial={{ name: frontmatter.name, description: frontmatter.description, tags: frontmatter.tags, color: frontmatter.color, archived: frontmatter.archived }}
          showArchived
          submitLabel="Save changes"
          pending={updateProjectMutation.isPending}
          onSubmit={(values) => updateProjectMutation.mutate(values)}
          onCancel={() => setEditing(false)}
        />
      ) : (
        frontmatter.description && <div className="pd-desc">{frontmatter.description}</div>
      )}

      <div className="pd-columns">
        {COLUMNS.map((col) => {
          const colTasks = byStatus(col.status);
          return (
            <div className="pd-column" key={col.status}>
              <div className="pd-column-header">
                {col.title} <span className="count">{colTasks.length}</span>
              </div>
              <div className="task-list">
                {colTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onStatusChange={(status) => updateTaskMutation.mutate({ taskId: task.id, values: { status } })}
                    onSave={(values) => updateTaskMutation.mutate({ taskId: task.id, values })}
                    onDelete={() => deleteTaskMutation.mutate(task.id)}
                    onLogToday={() => logTodayMutation.mutate(task.id)}
                  />
                ))}
                {colTasks.length === 0 && <div className="empty-note">Nothing here.</div>}
              </div>
            </div>
          );
        })}
      </div>

      <TaskForm compact submitLabel="+ Add task" pending={createTaskMutation.isPending} onSubmit={(values) => createTaskMutation.mutate(values)} />

      <HistoryPanel path={`projects/${slug}.md`} onReverted={invalidateProject} />
    </div>
  );
}
