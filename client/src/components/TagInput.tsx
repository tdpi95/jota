import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

/** Pill-style tag editor: type + Enter/comma to add, backspace on an empty
 * field to drop the last tag, × to remove any one. Also backs priority tags
 * like `#high` (PLAN.md: "#tag(s) — zero or more, also used for priority"),
 * so no separate priority control is needed. */
export default function TagInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const effectivePlaceholder = placeholder ?? t('tagInput.placeholder');

  function commitDraft() {
    const tag = draft.trim().replace(/^#/, '');
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setDraft('');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitDraft();
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="tag-input-wrap">
      {value.map((tag) => (
        <span className="tag-pill" key={tag}>
          {tag}
          <button type="button" onClick={() => onChange(value.filter((existing) => existing !== tag))} aria-label={t('tagInput.removeTag', { tag })}>
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commitDraft}
        placeholder={value.length === 0 ? effectivePlaceholder : ''}
      />
    </div>
  );
}
