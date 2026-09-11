import { useState } from 'react';

import type { UpdateTaskInput } from '../api/client';
import type { Task, TaskStatus } from '../types';
import DueDateBadge from './DueDateBadge';
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
 * due/tag/time-spent badges, an expandable description, and per-row actions
 * — edit (opens `TaskForm` inline in place of the row), delete, and
 * "+ log to today" (links this task onto today's journal entry, PLAN.md's
 * "+ log to today" quick action — built here on the shared row so Dashboard
 * (milestone 14) gets it for free once it reuses this component).
 */
export default function TaskRow({
  task,
  onStatusChange,
  onSave,
  onDelete,
  onLogToday,
}: {
  task: Task;
  onStatusChange: (status: TaskStatus) => void;
  onSave: (input: UpdateTaskInput) => void;
  onDelete: () => void;
  onLogToday?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [logged, setLogged] = useState(false);

  if (editing) {
    return (
      <div className="task-row">
        <div style={{ flex: 1 }}>
          <TaskForm
            task={task}
            submitLabel="Save"
            onSubmit={(values) => {
              onSave(values);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="task-row">
      <button
        className={`status-btn st-${task.status}`}
        onClick={() => onStatusChange(NEXT_STATUS[task.status])}
        title={`Mark as ${NEXT_STATUS[task.status]}`}
      >
        <StatusIcon status={task.status} />
      </button>
      <div className="task-main" onClick={() => task.description && setExpanded((v) => !v)}>
        <div className="task-title-row">
          <span className={`task-title ${task.status === 'done' ? 'st-done' : ''}`}>{task.text}</span>
        </div>
        <div className="task-meta-row">
          <DueDateBadge due={task.due} />
          {task.tags.map((tag) => (
            <span className="tag-pill" key={tag}>
              {tag}
            </span>
          ))}
          <TimeSpentBadge spentMinutes={task.spentMinutes} doingSince={task.doingSince} />
        </div>
        {expanded && task.description && <div className="task-desc">{task.description}</div>}
      </div>
      <div className="task-actions">
        {onLogToday && (
          <button
            className="icon-btn"
            title="Log to today's journal"
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
        <button className="icon-btn" title="Edit task" onClick={() => setEditing(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
        </button>
        <button className="icon-btn" title="Delete task" onClick={() => window.confirm(`Delete "${task.text}"?`) && onDelete()}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
