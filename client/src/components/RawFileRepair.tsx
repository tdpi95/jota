import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import * as api from '../api/client';
import MarkdownEditor from './MarkdownEditor';

/**
 * Shown in place of a note/journal page whose file can't be parsed (the
 * server's 422 — broken frontmatter YAML, leftover git conflict markers):
 * the parse error plus the file's raw markdown in an editor, so it can be
 * fixed right here instead of only in an outside text editor. Saving writes
 * the text verbatim, and the server rejects it (nothing written) while it
 * still doesn't parse — so a half-fixed file can't land. `onFixed` runs once
 * it saves, so the page can reload into its normal view.
 */
export default function RawFileRepair({
  error,
  queryKey,
  loadRaw,
  saveRaw,
  onFixed,
}: {
  error: string;
  queryKey: readonly unknown[];
  loadRaw: () => Promise<{ content: string }>;
  saveRaw: (content: string) => Promise<unknown>;
  onFixed: () => void;
}) {
  const { t } = useTranslation();
  const rawQuery = useQuery({ queryKey: [...queryKey, 'raw'], queryFn: loadRaw, gcTime: 0 });
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => {
    if (rawQuery.data && draft === null) setDraft(rawQuery.data.content);
  }, [rawQuery.data, draft]);

  const saveMutation = useMutation({ mutationFn: (content: string) => saveRaw(content), onSuccess: onFixed });
  const saveError = saveMutation.error instanceof api.ApiError ? saveMutation.error.message : saveMutation.isError ? t('rawFileRepair.saveFailed') : null;

  return (
    <div className="raw-repair">
      <p className="field-error raw-repair-error">{saveError ?? error}</p>
      <p className="page-sub">{t('rawFileRepair.hint')}</p>
      {rawQuery.isError ? (
        <p className="field-error">{t('rawFileRepair.loadFailed')}</p>
      ) : draft === null ? (
        <p className="page-sub">{t('common.loading')}</p>
      ) : (
        <>
          <MarkdownEditor className="journal-body raw-repair-editor" value={draft} onChange={setDraft} />
          <div className="form-actions raw-repair-actions">
            <button
              type="button"
              className="btn-primary"
              disabled={saveMutation.isPending || draft === rawQuery.data?.content}
              onClick={() => saveMutation.mutate(draft)}
            >
              {saveMutation.isPending ? t('rawFileRepair.saving') : t('rawFileRepair.save')}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={saveMutation.isPending || draft === rawQuery.data?.content}
              onClick={() => {
                setDraft(rawQuery.data?.content ?? '');
                saveMutation.reset();
              }}
            >
              {t('rawFileRepair.revert')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** A 422 from a note/journal read — the file exists but can't be parsed. */
export function isUnparsableFileError(error: unknown): error is InstanceType<typeof api.ApiError> {
  return error instanceof api.ApiError && error.statusCode === 422;
}
