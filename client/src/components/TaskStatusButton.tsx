import { useTranslation } from 'react-i18next';

import type { TaskStatus } from '../types';

const NEXT_STATUS: Record<TaskStatus, TaskStatus> = { todo: 'doing', doing: 'done', done: 'todo' };

export function StatusIcon({ status }: { status: TaskStatus }) {
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
 * The round status-cycle button (todo → doing → done → todo) — shared by
 * `TaskRow` (the Kanban board/Dashboard rows) and `TaskDetailView`, so the
 * task view modal changes status the same way the project page does.
 */
export default function TaskStatusButton({
  status,
  onChange,
  disabled = false,
}: {
  status: TaskStatus;
  onChange: (status: TaskStatus) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const nextStatus = NEXT_STATUS[status];
  return (
    <button
      type="button"
      className={`status-btn st-${status}`}
      onClick={() => onChange(nextStatus)}
      disabled={disabled}
      title={t('taskRow.markAs', { status: t(`taskRow.status.${nextStatus}`) })}
    >
      <StatusIcon status={status} />
    </button>
  );
}
