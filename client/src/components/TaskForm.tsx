import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CreateTaskInput, UpdateTaskInput } from '../api/client';
import type { Task } from '../types';
import MarkdownTextarea from './MarkdownTextarea';
import TagInput from './TagInput';

export interface TaskFormValues {
  text: string;
  due: string | null;
  tags: string[];
  description: string | null;
}

function initialValues(task?: Task): TaskFormValues {
  return {
    text: task?.text ?? '',
    due: task?.due ?? null,
    tags: task?.tags ?? [],
    description: task?.description ?? null,
  };
}

/**
 * Create/edit form for a task's text/due/tags/description. `compact` starts
 * with only the title field visible (matching design/Main.dc.html's
 * single-input "add-task-row" quick-add) with a "more fields" toggle to
 * reveal due/tags/description before submitting — used for the project
 * detail page's quick-add row. Editing an existing task (from `TaskRow`)
 * passes `compact={false}` so everything is visible immediately.
 */
export default function TaskForm({
  task,
  compact = false,
  submitLabel,
  pending = false,
  onSubmit,
  onCancel,
}: {
  task?: Task;
  compact?: boolean;
  submitLabel: string;
  pending?: boolean;
  onSubmit: (values: CreateTaskInput & UpdateTaskInput) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<TaskFormValues>(() => initialValues(task));
  const [expanded, setExpanded] = useState(!compact);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = values.text.trim();
    if (!text) return;
    onSubmit({
      text,
      due: values.due || null,
      tags: values.tags,
      description: values.description?.trim() ? values.description : null,
    });
    if (!task) setValues(initialValues());
  }

  return (
    <form onSubmit={handleSubmit}>
      {compact ? (
        <div className="add-task-row">
          <input
            className="add-task-input"
            placeholder={t('taskForm.titlePlaceholder')}
            value={values.text}
            onChange={(e) => setValues({ ...values, text: e.target.value })}
          />
          <button type="button" className="btn-secondary" onClick={() => setExpanded((v) => !v)}>
            {expanded ? t('taskForm.fewerFields') : t('taskForm.moreFields')}
          </button>
          <button type="submit" className="add-task-btn" disabled={!values.text.trim() || pending}>
            {t('taskForm.addTask')}
          </button>
        </div>
      ) : (
        <div className="form-field">
          <label>{t('taskForm.titleLabel')}</label>
          <input type="text" value={values.text} onChange={(e) => setValues({ ...values, text: e.target.value })} autoFocus />
        </div>
      )}

      {expanded && (
        <>
          <div className="form-field" style={{ marginTop: compact ? 12 : 0 }}>
            <label>{t('taskForm.dueDateLabel')}</label>
            <input
              type="date"
              value={values.due ?? ''}
              onChange={(e) => setValues({ ...values, due: e.target.value || null })}
            />
          </div>
          <div className="form-field">
            <label>{t('taskForm.tagsLabel')}</label>
            <TagInput value={values.tags} onChange={(tags) => setValues({ ...values, tags })} />
          </div>
          <div className="form-field">
            <label>{t('taskForm.descriptionLabel')}</label>
            <MarkdownTextarea
              rows={4}
              placeholder={t('taskForm.descriptionPlaceholder')}
              value={values.description ?? ''}
              onChange={(e) => setValues({ ...values, description: e.target.value })}
            />
          </div>
          {!compact && (
            <div className="form-actions">
              <button type="submit" className="btn-primary" disabled={!values.text.trim() || pending}>
                {submitLabel}
              </button>
              {onCancel && (
                <button type="button" className="btn-secondary" onClick={onCancel}>
                  {t('common.cancel')}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </form>
  );
}
