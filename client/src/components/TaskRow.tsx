import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import type { UpdateTaskInput } from '../api/client';
import { formatTimestamp } from '../lib/date';
import { renderMarkdownToHtml } from '../lib/renderMarkdown';
import type { Task, TaskStatus } from '../types';
import DueDateBadge from './DueDateBadge';
import Modal from './Modal';
import TaskForm from './TaskForm';
import TimeSpentBadge from './TimeSpentBadge';

const NEXT_STATUS: Record<TaskStatus, TaskStatus> = { todo: 'doing', doing: 'done', done: 'todo' };

function StatusIcon({ status }: { status: TaskStatus }) {
  if (status === 'doing') return <span className="pulse" />;
  if (status === 'done')
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 13l4 4L19 7" />
      </svg>
    );
  return null;
}

/**
 * One task row: status-cycle button (todo → doing → done → todo), title,
 * due/tag/time-spent badges, and per-row actions — edit (opens `TaskForm` in
 * a `Modal`), delete, and "+ log to today" (links this task onto today's
 * journal entry, PLAN.md's "+ log to today" quick action — built here on
 * the shared row so Dashboard (milestone 14) gets it for free once it
 * reuses this component). Clicking the row's title/meta area opens a *view*
 * `Modal` — badges, when created, checklist (still interactively checkable),
 * and description (rendered as markdown, same `renderMarkdownToHtml`
 * NoteBodyEditor's preview uses) — plus an Edit button that swaps straight
 * to the edit `Modal` — instead of the old inline expand-in-place (PLAN.md
 * milestone 18); every task opens it, not just ones with a checklist or
 * description, since "when created" alone is worth seeing. An optional `project`
 * badge (name + color dot) is shown first in the meta row when the caller
 * spans multiple projects (the Dashboard) — omitted on a single project's
 * own task list (ProjectDetailPage), where it would be redundant. When
 * `project` is given, a "Go to project" action also appears (milestone 18:
 * Dashboard buckets and the task-search popup both list tasks across every
 * project, so jumping to the owning project is useful there in a way it
 * isn't on ProjectDetailPage's own list).
 */
export default function TaskRow({
  task,
  project,
  onStatusChange,
  onSave,
  onDelete,
  onLogToday,
}: {
  task: Task;
  project?: { name: string; color: string; slug: string };
  onStatusChange: (status: TaskStatus) => void;
  onSave: (input: UpdateTaskInput) => void;
  onDelete: () => void;
  onLogToday?: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [logged, setLogged] = useState(false);

  const nextStatus = NEXT_STATUS[task.status];
  const hasChecklist = task.checklist.length > 0;
  const checklistDoneCount = task.checklist.filter((item) => item.done).length;

  function toggleChecklistItem(index: number) {
    onSave({
      checklist: task.checklist.map((item, i) => (i === index ? { ...item, done: !item.done } : item)),
    });
  }

  return (
    <div className="task-row">
      <button
        className={`status-btn st-${task.status}`}
        onClick={() => onStatusChange(nextStatus)}
        title={t('taskRow.markAs', { status: t(`taskRow.status.${nextStatus}`) })}
      >
        <StatusIcon status={task.status} />
      </button>
      <div className="task-main" onClick={() => setViewing(true)}>
        <div className="task-title-row">
          <span className={`task-title ${task.status === 'done' ? 'st-done' : ''}`}>{task.text}</span>
        </div>
        <div className="task-meta-row">
          {project && (
            <span className="project-badge">
              <span className="project-dot" style={{ background: project.color }} />
              {project.name}
            </span>
          )}
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
      </div>
      <div className="task-actions">
        {project && (
          <Link className="icon-btn" title={t('taskRow.goToProject')} aria-label={t('taskRow.goToProject')} to={`/projects/${project.slug}`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
            </svg>
          </Link>
        )}
        {onLogToday && (
          <button
            className="icon-btn"
            title={t('taskRow.logToTodaysJournal')}
            onClick={() => {
              onLogToday();
              setLogged(true);
              setTimeout(() => setLogged(false), 1500);
            }}
          >
            {logged ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--good)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                <path d="M9 8h6M9 12h4" />
              </svg>
            )}
          </button>
        )}
        <button className="icon-btn" title={t('taskRow.editTask')} onClick={() => setEditing(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
        </button>
        <button
          className="icon-btn"
          title={t('taskRow.deleteTask')}
          onClick={() => window.confirm(t('taskRow.confirmDelete', { text: task.text })) && onDelete()}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16z" />
          </svg>
        </button>
      </div>

      {viewing && (
        <Modal title={task.text} onClose={() => setViewing(false)}>
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
          {hasChecklist && (
            <div className="task-checklist">
              {task.checklist.map((item, index) => (
                <label className="task-checklist-item" key={index}>
                  <input type="checkbox" checked={item.done} onChange={() => toggleChecklistItem(index)} />
                  <span className={item.done ? 'st-done' : ''}>{item.text}</span>
                </label>
              ))}
            </div>
          )}
          {task.description && (
            <div className="task-desc note-preview" dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(task.description) }} />
          )}
          <div className="form-actions task-detail-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setViewing(false);
                setEditing(true);
              }}
            >
              {t('common.edit')}
            </button>
          </div>
        </Modal>
      )}

      {editing && (
        <Modal title={t('taskRow.editTaskModalTitle')} onClose={() => setEditing(false)}>
          <TaskForm
            task={task}
            submitLabel={t('common.save')}
            onSubmit={(values) => {
              onSave(values);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </Modal>
      )}
    </div>
  );
}
