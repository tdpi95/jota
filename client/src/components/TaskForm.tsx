import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CreateTaskInput, UpdateTaskInput } from '../api/client';
import { useUnsavedChanges } from '../lib/unsavedChanges';
import type { ChecklistItem, Task } from '../types';
import AttachmentField, { useAttachmentField } from './AttachmentField';
import ChecklistEditor from './ChecklistEditor';
import MarkdownEditor from './MarkdownEditor';
import TagInput from './TagInput';

export interface TaskFormValues {
  text: string;
  due: string | null;
  tags: string[];
  description: string | null;
  checklist: ChecklistItem[];
}

function initialValues(task?: Task, initialText?: string): TaskFormValues {
  return {
    text: task?.text ?? initialText ?? '',
    due: task?.due ?? null,
    tags: task?.tags ?? [],
    description: task?.description ?? null,
    checklist: task?.checklist ?? [],
  };
}

/**
 * Create/edit form for a task's text/due/tags/description. `compact` is
 * just the single-line "add-task-row" quick-add (matching
 * design/Main.dc.html) — its "more fields" button hands the typed title to
 * `onMoreFields` instead of expanding inline, so the caller can open the
 * full form in a `Modal` (PLAN.md milestone 18: task create/edit moved out
 * of the page flow into a popup, same as `ProjectForm`). Editing an existing
 * task (from `TaskRow`) or creating one with more than just a title both use
 * `compact={false}`, rendered inside that `Modal`.
 */
export default function TaskForm({
  task,
  compact = false,
  initialText,
  submitLabel,
  pending = false,
  onSubmit,
  onCancel,
  onMoreFields,
}: {
  task?: Task;
  compact?: boolean;
  /** Prefills the title field — used when `compact`'s quick-add row already
   * had text typed in before "more fields" opened the full-form `Modal`. */
  initialText?: string;
  submitLabel: string;
  pending?: boolean;
  onSubmit: (values: CreateTaskInput & UpdateTaskInput) => void;
  onCancel?: () => void;
  /** `compact` only: called with the currently-typed title when "more
   * fields" is clicked, instead of expanding this form in place. */
  onMoreFields?: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<TaskFormValues>(() => initialValues(task, initialText));
  const attachmentState = useAttachmentField('tasks', values.description ?? '', (next) => setValues((v) => ({ ...v, description: next })));

  // Feeds the global "warn before navigating away" keyboard-shortcut guard
  // (`useUnsavedChangesGuard`) — this form never autosaves, so a shortcut
  // jumping to another page while it's mid-edit would otherwise silently
  // drop whatever's typed. Compared against a snapshot of the *initial*
  // values (not re-derived from `task`/`initialText`) so a submit's own
  // `setValues(initialValues())` reset below correctly reads back as clean.
  const initialValuesRef = useRef(initialValues(task, initialText));
  useUnsavedChanges(JSON.stringify(values) !== JSON.stringify(initialValuesRef.current));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = values.text.trim();
    if (!text) return;
    onSubmit({
      text,
      due: values.due || null,
      tags: values.tags,
      description: values.description?.trim() ? values.description : null,
      checklist: values.checklist,
    });
    if (!task) setValues(initialValues());
  }

  if (compact) {
    return (
      <form onSubmit={handleSubmit}>
        <div className="add-task-row">
          <input
            className="add-task-input"
            placeholder={t('taskForm.titlePlaceholder')}
            value={values.text}
            onChange={(e) => setValues({ ...values, text: e.target.value })}
          />
          {onMoreFields && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                onMoreFields(values.text);
                setValues(initialValues());
              }}
            >
              {t('taskForm.moreFields')}
            </button>
          )}
          <button type="submit" className="add-task-btn" disabled={!values.text.trim() || pending}>
            {t('taskForm.addTask')}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-field">
        <label>{t('taskForm.titleLabel')}</label>
        <input type="text" value={values.text} onChange={(e) => setValues({ ...values, text: e.target.value })} autoFocus />
      </div>
      <div className="form-field">
        <label>{t('taskForm.dueDateLabel')}</label>
        <input type="date" value={values.due ?? ''} onChange={(e) => setValues({ ...values, due: e.target.value || null })} />
      </div>
      <div className="form-field">
        <label>{t('taskForm.tagsLabel')}</label>
        <TagInput value={values.tags} onChange={(tags) => setValues({ ...values, tags })} />
      </div>
      <div className="form-field">
        <label>{t('taskForm.checklistLabel')}</label>
        <ChecklistEditor value={values.checklist} onChange={(checklist) => setValues({ ...values, checklist })} />
      </div>
      <div className="form-field">
        <label>{t('taskForm.descriptionLabel')}</label>
        <MarkdownEditor
          className="task-desc-editor"
          placeholder={t('taskForm.descriptionPlaceholder')}
          value={values.description ?? ''}
          onChange={(next) => setValues({ ...values, description: next })}
          onPasteFiles={attachmentState.handleFiles}
        />
        <AttachmentField state={attachmentState} />
      </div>
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
    </form>
  );
}
