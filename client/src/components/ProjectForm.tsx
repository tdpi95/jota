import { useState } from 'react';

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
  onSubmit,
  onCancel,
}: {
  initial?: Partial<ProjectFormInitial>;
  showArchived?: boolean;
  submitLabel: string;
  pending?: boolean;
  onSubmit: (values: CreateProjectInput & UpdateProjectInput) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [color, setColor] = useState(initial?.color ?? COLOR_PALETTE[0]);
  const [archived, setArchived] = useState(initial?.archived ?? false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    setError(null);
    onSubmit({ name: name.trim(), description, tags, color, ...(showArchived ? { archived } : {}) });
  }

  return (
    <form className="form-panel" onSubmit={handleSubmit}>
      <div className="form-field">
        <label>Name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>
      {error && <div className="field-error">{error}</div>}
      <div className="form-field">
        <label>Description</label>
        <MarkdownTextarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this project about?" />
      </div>
      <div className="form-field">
        <label>Tags</label>
        <TagInput value={tags} onChange={setTags} />
      </div>
      <div className="form-field">
        <label>Color</label>
        <div className="color-swatches">
          {COLOR_PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              className={`color-swatch ${c === color ? 'selected' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
              aria-label={`Choose color ${c}`}
            />
          ))}
        </div>
      </div>
      {showArchived && (
        <div className="form-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" id="archived-toggle" checked={archived} onChange={(e) => setArchived(e.target.checked)} style={{ width: 'auto' }} />
          <label htmlFor="archived-toggle" style={{ textTransform: 'none', fontSize: 12.5, letterSpacing: 0 }}>
            Archived
          </label>
        </div>
      )}
      <div className="form-actions">
        <button type="submit" className="btn-primary" disabled={pending}>
          {submitLabel}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
