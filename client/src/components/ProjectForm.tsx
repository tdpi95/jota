import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CreateProjectInput, UpdateProjectInput } from '../api/client';
import { COLOR_PALETTE } from '../lib/colors';
import MarkdownTextarea from './MarkdownTextarea';
import TagInput from './TagInput';

export interface ProjectFormInitial {
  name: string;
  description: string;
  tags: string[];
  color: string;
  archived?: boolean;
}

/** Create/edit form for a project's name/description/tags/color (PLAN.md:
 * "project edit form for description/tags/color"). `showArchived` (edit
 * mode only) exposes the archive toggle — new projects are never created
 * archived. */
export default function ProjectForm({
  initial,
  showArchived = false,
  submitLabel,
  pending = false,
  bare = false,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<ProjectFormInitial>;
  showArchived?: boolean;
  submitLabel: string;
  pending?: boolean;
  /** Skip the `.form-panel` card chrome (background/border/padding) — for
   * when this form is nested inside `Modal`, which already supplies the
   * card. */
  bare?: boolean;
  onSubmit: (values: CreateProjectInput & UpdateProjectInput) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [color, setColor] = useState(initial?.color ?? COLOR_PALETTE[0]);
  const [archived, setArchived] = useState(initial?.archived ?? false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError(t('projectForm.nameRequired'));
      return;
    }
    setError(null);
    onSubmit({ name: name.trim(), description, tags, color, ...(showArchived ? { archived } : {}) });
  }

  return (
    <form className={bare ? 'form-panel form-panel--bare' : 'form-panel'} onSubmit={handleSubmit}>
      <div className="form-field">
        <label>{t('projectForm.nameLabel')}</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>
      {error && <div className="field-error">{error}</div>}
      <div className="form-field">
        <label>{t('projectForm.descriptionLabel')}</label>
        <MarkdownTextarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('projectForm.descriptionPlaceholder')} />
      </div>
      <div className="form-field">
        <label>{t('projectForm.tagsLabel')}</label>
        <TagInput value={tags} onChange={setTags} />
      </div>
      <div className="form-field">
        <label>{t('projectForm.colorLabel')}</label>
        <div className="color-swatches">
          {COLOR_PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              className={`color-swatch ${c === color ? 'selected' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
              aria-label={t('projectForm.chooseColor', { color: c })}
            />
          ))}
          <input
            type="color"
            className={`color-swatch color-swatch-custom ${!COLOR_PALETTE.includes(color) ? 'selected' : ''}`}
            value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#000000'}
            onChange={(e) => setColor(e.target.value)}
            title={t('projectForm.customColorTooltip')}
            aria-label={t('projectForm.chooseCustomColor')}
          />
        </div>
      </div>
      {showArchived && (
        <div className="form-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" id="archived-toggle" checked={archived} onChange={(e) => setArchived(e.target.checked)} style={{ width: 'auto' }} />
          <label htmlFor="archived-toggle" style={{ textTransform: 'none', fontSize: 12.5, letterSpacing: 0 }}>
            {t('projectForm.archivedLabel')}
          </label>
        </div>
      )}
      <div className="form-actions">
        <button type="submit" className="btn-primary" disabled={pending}>
          {submitLabel}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
