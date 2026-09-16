import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { handleRenderedAttachmentClick } from '../lib/attachments';
import { renderMarkdownToHtml } from '../lib/renderMarkdown';
import AttachmentField, { useAttachmentField } from './AttachmentField';
import MarkdownEditor from './MarkdownEditor';

// Pencil (edit) / eye (preview, same path HistoryPanel's "view diff" button
// already uses) — icon-only, so each button still carries its label via
// `title`/`aria-label` rather than visible text.
const VIEW_MODE_ICONS: Record<'edit' | 'preview', React.ReactNode> = {
  edit: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  ),
  preview: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
};

/** Exported so the pencil glyph can be reused for the filename-rename
 * affordance (NoteDetailPage), which isn't otherwise related to this
 * edit/preview toggle. */
export { VIEW_MODE_ICONS };

/**
 * The note body's Edit ↔ rendered-preview toggle plus the editor/preview
 * itself — shared between `NoteDetailPage` (an existing note) and
 * `NewNotePage` (a not-yet-created draft), which otherwise differ in almost
 * everything else (fetching, autosave-vs-create-on-first-edit, delete,
 * history, filename). Owns its own `viewMode` state — each mounted note
 * (existing or draft) starts fresh in Edit mode, which is what's wanted
 * either way.
 */
export default function NoteBodyEditor({
  body,
  onChange,
  disabled,
}: {
  body: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit');
  const attachmentState = useAttachmentField('notes', body, onChange);

  return (
    <>
      <div className="note-view-toggle" role="radiogroup" aria-label={t('noteDetail.viewMode.sectionTitle') ?? undefined}>
        {(['edit', 'preview'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={viewMode === m}
            title={t(`noteDetail.viewMode.${m}`)}
            aria-label={t(`noteDetail.viewMode.${m}`)}
            className={`ws-row-btn note-view-toggle-btn ${viewMode === m ? 'is-active' : ''}`}
            onClick={() => setViewMode(m)}
          >
            {VIEW_MODE_ICONS[m]}
          </button>
        ))}
      </div>

      {viewMode === 'edit' ? (
        <>
          <MarkdownEditor
            className="journal-body"
            placeholder={t('noteDetail.bodyPlaceholder')}
            value={body}
            onChange={onChange}
            onPasteFiles={attachmentState.handleFiles}
            disabled={disabled}
          />
          <AttachmentField state={attachmentState} disabled={disabled} />
        </>
      ) : body.trim() ? (
        <div
          className="note-preview journal-body"
          onClick={handleRenderedAttachmentClick}
          dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(body) }}
        />
      ) : (
        <div className="note-preview journal-body note-preview-empty">{t('noteDetail.previewEmpty')}</div>
      )}
    </>
  );
}
