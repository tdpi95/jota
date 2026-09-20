import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import * as api from '../api/client';
import { lastActivity } from '../lib/projects';
import { useUnsavedChanges } from '../lib/unsavedChanges';
import Modal from './Modal';

/**
 * Project-picker task quick-add, in a `Modal` — originally Dashboard-only,
 * pulled out here so the global "quick add task" keyboard shortcut
 * (`KeyboardShortcuts`) can open the exact same flow from any page, without
 * duplicating the mutation/invalidate logic. Defaults the project select to
 * whichever project was most recently active (`lastActivity`, same sort
 * Dashboard's own "Recent projects" section uses) — "the project I was just
 * working in" is the most likely target for a task jotted down in passing.
 */
export default function QuickAddTaskModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: api.listProjects });

  const [text, setText] = useState('');
  const [slug, setSlug] = useState('');

  const projects = projectsQuery.data?.projects ?? [];
  const selectableProjects = projects.filter((p) => !p.frontmatter.archived);
  const mostRecentSlug = [...selectableProjects].sort((a, b) => lastActivity(b) - lastActivity(a))[0]?.slug;
  const selectedSlug = slug || mostRecentSlug || selectableProjects[0]?.slug || '';

  useUnsavedChanges(text.trim().length > 0);

  const mutation = useMutation({
    mutationFn: ({ slug, text }: { slug: string; text: string }) => api.createTask(slug, { text }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', 'open'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
      onClose();
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || !selectedSlug) return;
    mutation.mutate({ slug: selectedSlug, text: trimmed });
  }

  return (
    <Modal title={t('dashboard.quickAddTaskTitle')} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="quick-add-row">
          <input
            className="add-task-input"
            placeholder={t('dashboard.taskTitlePlaceholder')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          <select className="quick-add-select" value={selectedSlug} onChange={(e) => setSlug(e.target.value)}>
            {selectableProjects.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.frontmatter.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn-primary" disabled={!text.trim() || !selectedSlug || mutation.isPending}>
            {t('dashboard.addTaskSubmit')}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t('dashboard.cancel')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
