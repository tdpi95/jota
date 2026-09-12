import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { ChecklistItem } from '../types';

/**
 * Add/edit/remove/toggle a task's checklist (sub-tasks) — used inside
 * `TaskForm`. Deliberately plain (text + done only, no due/tags of its own,
 * matching the on-disk grammar's `ChecklistItem`) and always a full-array
 * `onChange`, same convention `TagInput` already uses for `tags`.
 */
export default function ChecklistEditor({ value, onChange }: { value: ChecklistItem[]; onChange: (items: ChecklistItem[]) => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');

  function addItem() {
    const text = draft.trim();
    if (!text) return;
    onChange([...value, { text, done: false }]);
    setDraft('');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addItem();
    }
  }

  function updateItem(index: number, patch: Partial<ChecklistItem>) {
    onChange(value.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function removeItem(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div className="checklist-editor">
      {value.map((item, index) => (
        <div className="checklist-editor-row" key={index}>
          <input type="checkbox" checked={item.done} onChange={(e) => updateItem(index, { done: e.target.checked })} />
          <input
            className="checklist-editor-text"
            value={item.text}
            onChange={(e) => updateItem(index, { text: e.target.value })}
          />
          <button
            type="button"
            className="checklist-editor-remove"
            onClick={() => removeItem(index)}
            aria-label={t('checklistEditor.removeItem')}
          >
            ×
          </button>
        </div>
      ))}
      <div className="checklist-editor-add">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('checklistEditor.addPlaceholder')}
        />
        <button type="button" className="btn-secondary" onClick={addItem} disabled={!draft.trim()}>
          {t('checklistEditor.addItem')}
        </button>
      </div>
    </div>
  );
}
