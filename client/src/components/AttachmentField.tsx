import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { uploadAttachment } from '../api/client';
import {
  appendAttachment,
  attachmentMarkdown,
  openAttachmentIfPossible,
  parseAttachmentRefs,
  type AttachmentBodyFolder,
  type ParsedAttachmentRef,
} from '../lib/attachments';

const PAPERCLIP_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.44 11.05 12.25 20.24a5 5 0 0 1-7.07-7.07L14.36 4a3.5 3.5 0 0 1 4.95 4.95L10.13 18.13a2 2 0 0 1-2.83-2.83l7.78-7.78" />
  </svg>
);

const FILE_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </svg>
);

export interface AttachmentFieldState {
  uploading: boolean;
  error: string | null;
  attachments: ParsedAttachmentRef[];
  /** Uploads every given file in order, appending a markdown reference for
   * each to the end of the current text — shared by the "attach file"
   * button (always one file) and a clipboard paste (which can carry more
   * than one, e.g. copying several files from a file manager at once). */
  handleFiles: (files: FileList | File[] | null) => void;
}

/**
 * The upload+insert logic behind `AttachmentField` (milestone 27, PLAN.md
 * "File attachments"), split out as its own hook so a paste-from-clipboard
 * handler on `MarkdownEditor` — which lives outside this component's own
 * DOM — can trigger the exact same upload/append/list-refresh path a click
 * on the attach button does, rather than a second, drifting implementation.
 */
export function useAttachmentField(folder: AttachmentBodyFolder, value: string, onChange: (next: string) => void): AttachmentFieldState {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = useCallback(
    (files: FileList | File[] | null) => {
      const list = files ? Array.from(files) : [];
      if (list.length === 0) return;
      setUploading(true);
      setError(null);
      (async () => {
        let next = value;
        for (const file of list) {
          const { attachment } = await uploadAttachment(folder, file);
          const ref = attachmentMarkdown(folder, attachment.filename, file.type.startsWith('image/'));
          next = appendAttachment(next, ref);
        }
        onChange(next);
      })()
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setUploading(false));
    },
    [folder, value, onChange],
  );

  return { uploading, error, handleFiles, attachments: parseAttachmentRefs(value, folder) };
}

/**
 * "Attach file" button + the inline thumbnail/chip list for whatever
 * attachments are already embedded in `value` — shared by the journal body,
 * note body, and task description editors. Uploading appends a markdown
 * image/link reference to the end of `value` (not inserted at the cursor —
 * `MarkdownEditor` doesn't expose one, and end-of-body is simple and
 * predictable) and immediately shows it below, independent of whether the
 * surrounding editor has its own rendered-preview mode. Takes the
 * `useAttachmentField` state as props (rather than owning it) so a caller
 * can share the exact same state/handler with `MarkdownEditor`'s
 * `onPasteFiles` for paste-from-clipboard support.
 */
export default function AttachmentField({ state, disabled }: { state: AttachmentFieldState; disabled?: boolean }) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { uploading, error, handleFiles, attachments } = state;

  return (
    <div className="attachment-field">
      <div className="attachment-toolbar">
        <button
          type="button"
          className="ws-row-btn attachment-attach-btn"
          title={t('attachments.attachFile')}
          aria-label={t('attachments.attachFile')}
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
        >
          {PAPERCLIP_ICON}
        </button>
        <input
          ref={inputRef}
          type="file"
          hidden
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
        {uploading && <span className="attachment-status">{t('attachments.uploading')}</span>}
      </div>
      {error && <div className="field-error">{error}</div>}
      {attachments.length > 0 && (
        <ul className="attachment-list">
          {attachments.map((a) => (
            <li className="attachment-chip" key={a.filename}>
              {a.isImage ? (
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="attachment-thumb-link"
                  title={a.filename}
                  onClick={(e) => openAttachmentIfPossible(e, a.url)}
                >
                  <img src={a.url} alt={a.filename} className="attachment-thumb" />
                </a>
              ) : (
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="attachment-file-link"
                  title={a.filename}
                  onClick={(e) => openAttachmentIfPossible(e, a.url)}
                >
                  {FILE_ICON}
                  <span>{a.filename}</span>
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
