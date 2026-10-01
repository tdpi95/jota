import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import * as api from '../api/client';
import { lastActivity } from '../lib/projects';
import { useUnsavedChanges } from '../lib/unsavedChanges';
import type { Task } from '../types';
import Modal from './Modal';
import TaskDetailView from './TaskDetailView';
import TaskForm from './TaskForm';

/**
 * Which step of the flow the popup is on — all inside one `Modal`, so moving
 * between steps swaps its content rather than remounting the overlay:
 * - `quick`: the single-line title + project select.
 * - `full`: "More fields" — the full `TaskForm` (due/tags/checklist/
 *   description), with the project select kept above it and the typed title
 *   carried over.
 * - `created`: the task just created, via `TaskDetailView`, with Edit, a
 *   Todo/Doing/Done toggle, and "Go to project".
 * - `editing`: `TaskForm` in edit mode for that same task; saving or
 *   cancelling returns to `created`.
 */
type Step = { kind: 'quick' } | { kind: 'full' } | { kind: 'created'; slug: string; task: Task } | { kind: 'editing'; slug: string; task: Task };

/**
 * Project-picker task quick-add, in a `Modal` — originally Dashboard-only,
 * pulled out here so the global "quick add task" keyboard shortcut
 * (`KeyboardShortcuts`) can open the exact same flow from any page, without
 * duplicating the mutation/invalidate logic. Defaults the project select to
 * whichever project was most recently active (`lastActivity`, same sort
 * Dashboard's own "Recent projects" section uses) — "the project I was just
 * working in" is the most likely target for a task jotted down in passing.
 * After a successful create it stays open on the new task (see `Step`)
 * instead of closing, so a follow-up edit/status change/jump to its project
 * doesn't mean hunting the task down again.
 */
export default function QuickAddTaskModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: api.listProjects });

  const [step, setStep] = useState<Step>({ kind: 'quick' });
  const [text, setText] = useState('');
  const [slug, setSlug] = useState('');

  const projects = projectsQuery.data?.projects ?? [];
  const selectableProjects = projects.filter((p) => !p.frontmatter.archived);
  const mostRecentSlug = [...selectableProjects].sort((a, b) => lastActivity(b) - lastActivity(a))[0]?.slug;
  const selectedSlug = slug || mostRecentSlug || selectableProjects[0]?.slug || '';

  // `full`/`editing` register their own dirty state via `TaskForm`.
  useUnsavedChanges(step.kind === 'quick' && text.trim().length > 0);

  function invalidate(projectSlug: string) {
    queryClient.invalidateQueries({ queryKey: ['tasks', 'open'] });
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    queryClient.invalidateQueries({ queryKey: ['project', projectSlug] });
    queryClient.invalidateQueries({ queryKey: ['calendar'] });
  }

  const createMutation = useMutation({
    mutationFn: ({ slug, input }: { slug: string; input: api.CreateTaskInput }) => api.createTask(slug, input),
    onSuccess: ({ task }, { slug }) => {
      invalidate(slug);
      setStep({ kind: 'created', slug, task });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ slug, taskId, input }: { slug: string; taskId: string; input: api.UpdateTaskInput }) => api.updateTask(slug, taskId, input),
    onSuccess: ({ task }, { slug }) => {
      invalidate(slug);
      setStep({ kind: 'created', slug, task });
    },
  });

  function handleQuickSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || !selectedSlug) return;
    createMutation.mutate({ slug: selectedSlug, input: { text: trimmed } });
  }

  const projectSelect = (
    <select className="quick-add-select" value={selectedSlug} onChange={(e) => setSlug(e.target.value)}>
      {selectableProjects.map((p) => (
        <option key={p.slug} value={p.slug}>
          {p.frontmatter.name}
        </option>
      ))}
    </select>
  );

  if (step.kind === 'created') {
    const { slug: taskSlug, task } = step;
    const projectName = projects.find((p) => p.slug === taskSlug)?.frontmatter.name ?? taskSlug;
    const update = (input: api.UpdateTaskInput) => updateMutation.mutate({ slug: taskSlug, taskId: task.id, input });
    return (
      <Modal title={task.text} onClose={onClose}>
        <TaskDetailView
          task={task}
          notice={t('dashboard.taskAddedTo', { project: projectName })}
          pending={updateMutation.isPending}
          onSave={update}
          onStatusChange={(status) => update({ status })}
          onEdit={() => setStep({ kind: 'editing', slug: taskSlug, task })}
          onGoToProject={() => {
            onClose();
            navigate(`/projects/${taskSlug}`, { state: { highlightTaskId: task.id } });
          }}
        />
      </Modal>
    );
  }

  if (step.kind === 'editing') {
    const { slug: taskSlug, task } = step;
    const backToCreated = () => setStep({ kind: 'created', slug: taskSlug, task });
    return (
      <Modal title={t('taskRow.editTaskModalTitle')} onClose={backToCreated}>
        <TaskForm
          task={task}
          submitLabel={t('common.save')}
          pending={updateMutation.isPending}
          onSubmit={(values) => updateMutation.mutate({ slug: taskSlug, taskId: task.id, input: values })}
          onCancel={backToCreated}
        />
      </Modal>
    );
  }

  if (step.kind === 'full') {
    return (
      <Modal title={t('dashboard.quickAddTaskTitle')} onClose={onClose}>
        <div className="form-field">
          <label>{t('dashboard.projectLabel')}</label>
          {projectSelect}
        </div>
        <TaskForm
          initialText={text.trim()}
          submitLabel={t('dashboard.addTaskSubmit')}
          pending={createMutation.isPending || !selectedSlug}
          onSubmit={(input) => selectedSlug && createMutation.mutate({ slug: selectedSlug, input })}
          onCancel={onClose}
        />
      </Modal>
    );
  }

  return (
    <Modal title={t('dashboard.quickAddTaskTitle')} onClose={onClose}>
      <form onSubmit={handleQuickSubmit}>
        <div className="quick-add-row">
          <input
            className="add-task-input"
            placeholder={t('dashboard.taskTitlePlaceholder')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          {projectSelect}
        </div>
        <div className="form-actions">
          <button type="submit" className="btn-primary" disabled={!text.trim() || !selectedSlug || createMutation.isPending}>
            {t('dashboard.addTaskSubmit')}
          </button>
          <button type="button" className="btn-secondary" onClick={() => setStep({ kind: 'full' })}>
            {t('taskForm.moreFields')}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t('dashboard.cancel')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
