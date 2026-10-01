import { useTranslation } from 'react-i18next';

import type { UpdateTaskInput } from '../api/client';
import { handleRenderedAttachmentClick } from '../lib/attachments';
import { formatTimestamp } from '../lib/date';
import { renderMarkdownToHtml } from '../lib/renderMarkdown';
import type { Task, TaskStatus } from '../types';
import DueDateBadge from './DueDateBadge';
import TimeSpentBadge from './TimeSpentBadge';

const STATUSES: TaskStatus[] = ['todo', 'doing', 'done'];

/**
 * Body of a task's *view* `Modal` — badges, created time, interactive
 * checklist, rendered description, and an Edit button. The caller owns the
 * `Modal` itself (and its title), so a flow that swaps between several views
 * inside one popup (`QuickAddTaskModal`: quick-add → created → edit) doesn't
 * remount the overlay on every step. Shared by `TaskRow`'s click-to-view and
 * `QuickAddTaskModal`'s "here's the task you just created" step; the latter
 * also passes `onStatusChange` (a Todo/Doing/Done toggle, same
 * `.ws-row-btn.is-active` pattern as the app's other segmented toggles) and
 * `onGoToProject`, both omitted by `TaskRow`, whose row already carries its
 * own status button and "go to project" action.
 */
export default function TaskDetailView({
  task,
  notice,
  onSave,
  onEdit,
  onStatusChange,
  onGoToProject,
  pending = false,
}: {
  task: Task;
  /** Optional one-line context shown above the badges (e.g. "Added to X"). */
  notice?: React.ReactNode;
  onSave: (input: UpdateTaskInput) => void;
  onEdit: () => void;
  onStatusChange?: (status: TaskStatus) => void;
  onGoToProject?: () => void;
  pending?: boolean;
}) {
  const { t } = useTranslation();
  const hasChecklist = task.checklist.length > 0;
  const checklistDoneCount = task.checklist.filter((item) => item.done).length;

  function toggleChecklistItem(index: number) {
    onSave({
      checklist: task.checklist.map((item, i) => (i === index ? { ...item, done: !item.done } : item)),
    });
  }

  return (
    <>
      {notice && <div className="task-detail-notice">{notice}</div>}
      <div className="task-meta-row">
        <DueDateBadge due={task.due} />
        {hasChecklist && (
          <span className="checklist-badge">
            {checklistDoneCount}/{task.checklist.length}
          </span>
        )}
        {task.tags.map((tag) => (
          <span className="tag-pill" key={tag}>
            {tag}
          </span>
        ))}
        <TimeSpentBadge spentMinutes={task.spentMinutes} doingSince={task.doingSince} />
      </div>
      <div className="page-sub">{t('taskRow.created', { time: formatTimestamp(task.created) })}</div>
      {onStatusChange && (
        <div className="task-detail-status" role="group" aria-label={t('taskRow.statusLabel')}>
          {STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className={`ws-row-btn ${task.status === status ? 'is-active' : ''}`}
              aria-pressed={task.status === status}
              disabled={pending || task.status === status}
              onClick={() => onStatusChange(status)}
            >
              {t(`projectDetail.columns.${status}`)}
            </button>
          ))}
        </div>
      )}
      {hasChecklist && (
        <div className="task-checklist">
          {task.checklist.map((item, index) => (
            <label className="task-checklist-item" key={index}>
              <input type="checkbox" checked={item.done} disabled={pending} onChange={() => toggleChecklistItem(index)} />
              <span className={item.done ? 'st-done' : ''}>{item.text}</span>
            </label>
          ))}
        </div>
      )}
      {task.description && (
        <div
          className="task-desc note-preview"
          onClick={handleRenderedAttachmentClick}
          dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(task.description) }}
        />
      )}
      <div className="form-actions task-detail-actions">
        <button type="button" className="btn-primary" onClick={onEdit}>
          {t('common.edit')}
        </button>
        {onGoToProject && (
          <button type="button" className="btn-secondary" onClick={onGoToProject}>
            {t('taskRow.goToProject')}
          </button>
        )}
      </div>
    </>
  );
}
