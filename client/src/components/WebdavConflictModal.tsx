import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import * as api from '../api/client';
import type { DiffHunk, MergeChunk, WebDavConflictDetail, WebDavResolution } from '../types';
import Modal from './Modal';

/** Unchanged runs longer than this are collapsed in the merge view down to
 * `CONTEXT_LINES` on each end, so the conflicts themselves stay on screen. */
const COLLAPSE_OVER = 8;
const CONTEXT_LINES = 3;

type Pick = 'local' | 'remote' | 'both';

/**
 * Resolver for one WebDAV sync conflict (PLAN.md "Remote & cloud sync" #3,
 * "Resolving a conflict"). "What changed" shows each side's own edits since
 * the last sync (or a direct this-device-vs-server diff when there's no
 * last-synced copy); "Merge" shows the server's pre-merged draft, where
 * every non-overlapping edit is already combined and each overlapping spot
 * is a choice — this device's lines, the server's, or both — with a
 * free-text fallback for anything finer. Whatever's picked is written to
 * both sides by `POST /api/vault/webdav/conflict/resolve`.
 */
export default function WebdavConflictModal({
  path,
  onClose,
  onResolved,
}: {
  path: string;
  onClose: () => void;
  onResolved: (localChanged: boolean) => void;
}) {
  const { t } = useTranslation();
  const detailQuery = useQuery({
    queryKey: ['sync', 'webdav-conflict', path],
    queryFn: () => api.getWebdavConflict(path),
    retry: false,
    staleTime: Infinity,
  });
  const detail = detailQuery.data;

  return (
    <Modal title={t('settings.sync.webdav.conflict.title')} onClose={onClose} wide>
      <div className="conflict-path">{path}</div>
      {detailQuery.isLoading && (
        <p className="empty-note">
          <span className="spinner" />
          {t('settings.sync.webdav.conflict.loading')}
        </p>
      )}
      {detailQuery.error && (
        <div className="conflict-error">
          {detailQuery.error instanceof api.ApiError && detailQuery.error.statusCode === 404
            ? t('settings.sync.webdav.conflict.noLongerConflicted')
            : detailQuery.error instanceof api.ApiError
              ? detailQuery.error.message
              : t('settings.sync.actionFailed')}
        </div>
      )}
      {detail && <ConflictBody key={`${detail.version.localMtimeMs}:${detail.version.remoteEtag}`} detail={detail} onResolved={onResolved} onReload={() => detailQuery.refetch()} />}
    </Modal>
  );
}

function ConflictBody({ detail, onResolved, onReload }: { detail: WebDavConflictDetail; onResolved: (localChanged: boolean) => void; onReload: () => void }) {
  const { t } = useTranslation();
  const [view, setView] = useState<'changes' | 'merge'>(detail.merge ? 'merge' : 'changes');

  const resolveMutation = useMutation({
    mutationFn: (resolution: WebDavResolution) => api.resolveWebdavConflict({ path: detail.path, resolution, expected: detail.version }),
    onSuccess: (result) => onResolved(result.localChanged),
  });
  const staleError = resolveMutation.error instanceof api.ApiError && resolveMutation.error.statusCode === 409;

  return (
    <>
      <p className="conflict-summary">{summaryText(detail, t)}</p>

      {detail.merge && (
        <div className="conflict-tabs">
          <button className={`ws-row-btn ${view === 'merge' ? 'is-active' : ''}`} onClick={() => setView('merge')}>
            {t('settings.sync.webdav.conflict.mergeTab')}
          </button>
          <button className={`ws-row-btn ${view === 'changes' ? 'is-active' : ''}`} onClick={() => setView('changes')}>
            {t('settings.sync.webdav.conflict.changesTab')}
          </button>
        </div>
      )}

      {view === 'changes' ? (
        <ChangesView detail={detail} />
      ) : (
        <MergeView chunks={detail.merge!} hasBase={detail.hasBase} disabled={resolveMutation.isPending} onSave={(content) => resolveMutation.mutate({ choice: 'merged', content })} />
      )}

      <div className="conflict-keep">
        <div className="section-title" style={{ marginBottom: 8 }}>
          {t('settings.sync.webdav.conflict.orKeepOne')}
        </div>
        <div className="sync-actions" style={{ flexWrap: 'wrap' }}>
          <button className="btn-secondary" disabled={resolveMutation.isPending} onClick={() => resolveMutation.mutate({ choice: 'local' })}>
            {detail.local === 'deleted' ? t('settings.sync.webdav.conflict.keepLocalDeletion') : t('settings.sync.webdav.conflict.keepLocal')}
          </button>
          <button className="btn-secondary" disabled={resolveMutation.isPending} onClick={() => resolveMutation.mutate({ choice: 'remote' })}>
            {detail.remote === 'deleted' ? t('settings.sync.webdav.conflict.keepRemoteDeletion') : t('settings.sync.webdav.conflict.keepRemote')}
          </button>
          {resolveMutation.isPending && (
            <span className="sync-checking">
              <span className="spinner" />
              {t('settings.sync.webdav.conflict.saving')}
            </span>
          )}
        </div>
        <p className="conflict-hint">{t('settings.sync.webdav.conflict.undoHint')}</p>
      </div>

      {resolveMutation.error && (
        <div className="conflict-error">
          {staleError ? t('settings.sync.webdav.conflict.changedAgain') : resolveMutation.error instanceof api.ApiError ? resolveMutation.error.message : t('settings.sync.actionFailed')}
          {staleError && (
            <button className="list-toggle-btn conflict-link" onClick={onReload}>
              {t('settings.sync.webdav.conflict.reload')}
            </button>
          )}
        </div>
      )}
    </>
  );
}

function summaryText(detail: WebDavConflictDetail, t: (key: string) => string): string {
  const key =
    detail.local === 'created' && detail.remote === 'created'
      ? 'bothAdded'
      : detail.local === 'deleted'
        ? 'deletedHereEditedThere'
        : detail.remote === 'deleted'
          ? 'editedHereDeletedThere'
          : 'bothEdited';
  const noBase = detail.isText && !detail.hasBase && key === 'bothEdited' ? ` ${t('settings.sync.webdav.conflict.noBase')}` : '';
  return t(`settings.sync.webdav.conflict.summary.${key}`) + noBase;
}

// --- "What changed" -------------------------------------------------------

function formatSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ChangesView({ detail }: { detail: WebDavConflictDetail }) {
  const { t } = useTranslation();

  if (!detail.isText) {
    return (
      <div className="conflict-section">
        <p className="conflict-hint">{t('settings.sync.webdav.conflict.binaryNotice')}</p>
        <div className="sync-counts">
          <span>
            {t('settings.sync.webdav.conflict.thisDevice')}: <b>{detail.local === 'deleted' ? t('settings.sync.webdav.conflict.deleted') : formatSize(detail.localSize)}</b>
          </span>
          <span>
            {t('settings.sync.webdav.conflict.server')}: <b>{detail.remote === 'deleted' ? t('settings.sync.webdav.conflict.deleted') : formatSize(detail.remoteSize)}</b>
          </span>
        </div>
      </div>
    );
  }

  if (detail.hasBase) {
    return (
      <>
        <SideChanges label={t('settings.sync.webdav.conflict.changedOnThisDevice')} state={detail.local} hunks={detail.localChanges} />
        <SideChanges label={t('settings.sync.webdav.conflict.changedOnServer')} state={detail.remote} hunks={detail.remoteChanges} />
      </>
    );
  }

  if (detail.differences) {
    return (
      <div className="conflict-section">
        <div className="section-title" style={{ marginBottom: 6 }}>
          {t('settings.sync.webdav.conflict.differences')}
        </div>
        <p className="conflict-hint">
          <span className="conflict-legend is-del">−</span> {t('settings.sync.webdav.conflict.server')} &nbsp;
          <span className="conflict-legend is-add">+</span> {t('settings.sync.webdav.conflict.thisDevice')}
        </p>
        <DiffView hunks={detail.differences} />
      </div>
    );
  }

  return <p className="conflict-hint">{t('settings.sync.webdav.conflict.nothingToCompare')}</p>;
}

function SideChanges({ label, state, hunks }: { label: string; state: WebDavConflictDetail['local']; hunks: DiffHunk[] | null }) {
  const { t } = useTranslation();
  return (
    <div className="conflict-section">
      <div className="section-title" style={{ marginBottom: 6 }}>
        {label}
      </div>
      {state === 'deleted' ? (
        <p className="conflict-hint">{t('settings.sync.webdav.conflict.fileDeleted')}</p>
      ) : hunks && hunks.length > 0 ? (
        <DiffView hunks={hunks} />
      ) : (
        <p className="conflict-hint">{t('settings.sync.webdav.conflict.noTextChanges')}</p>
      )}
    </div>
  );
}

function DiffView({ hunks }: { hunks: DiffHunk[] }) {
  const { t } = useTranslation();
  return (
    <div className="conflict-diff">
      {hunks.map((hunk, i) => (
        <div key={i}>
          <div className="conflict-diff-hunk">{t('settings.sync.webdav.conflict.lineNumber', { line: hunk.newStart })}</div>
          {hunk.lines.map((line, j) => (
            <div key={j} className={`conflict-diff-line ${line.type === '+' ? 'is-add' : line.type === '-' ? 'is-del' : ''}`}>
              <span className="conflict-diff-sign">{line.type}</span>
              {line.text || ' '}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// --- "Merge" -------------------------------------------------------------

function MergeView({ chunks, hasBase, disabled, onSave }: { chunks: MergeChunk[]; hasBase: boolean; disabled: boolean; onSave: (content: string) => void }) {
  const { t } = useTranslation();
  const conflictCount = chunks.filter((c) => c.kind === 'conflict').length;
  const [picks, setPicks] = useState<(Pick | null)[]>(() => chunks.map(() => null));
  const [manualText, setManualText] = useState<string | null>(null);

  const assembled = assemble(chunks, picks, { local: t('settings.sync.webdav.conflict.thisDevice'), remote: t('settings.sync.webdav.conflict.server') });
  const unresolved = picks.filter((p, i) => chunks[i].kind === 'conflict' && p === null).length;

  const manual = manualText !== null;
  const hasMarkers = manual && /^(<{7}|={7}|>{7})( |$)/m.test(manualText);
  const canSave = manual ? !hasMarkers : unresolved === 0;

  function pick(index: number, value: Pick | null) {
    setPicks((prev) => prev.map((p, i) => (i === index ? value : p)));
  }

  let conflictNumber = 0;
  return (
    <div className="conflict-section">
      <p className="conflict-hint">
        {conflictCount === 0
          ? t('settings.sync.webdav.conflict.mergeClean')
          : hasBase
            ? t('settings.sync.webdav.conflict.mergeIntro', { count: conflictCount })
            : t('settings.sync.webdav.conflict.mergeIntroNoBase', { count: conflictCount })}
      </p>

      {manual ? (
        <textarea className="conflict-manual" value={manualText} spellCheck={false} onChange={(e) => setManualText(e.target.value)} />
      ) : (
        <div className="conflict-merge">
          {chunks.map((chunk, i) => {
            if (chunk.kind === 'ok') return <UnchangedLines key={i} lines={chunk.lines} />;
            conflictNumber++;
            const chosen = picks[i];
            return (
              <div key={i} className={`conflict-block ${chosen ? 'is-picked' : ''}`}>
                <div className="conflict-block-head">
                  <span>{t('settings.sync.webdav.conflict.spot', { n: conflictNumber, total: conflictCount })}</span>
                  {chosen && (
                    <button className="list-toggle-btn conflict-link" onClick={() => pick(i, null)}>
                      {t('settings.sync.webdav.conflict.change')}
                    </button>
                  )}
                </div>
                {chosen ? (
                  <pre className="conflict-lines">{pickedLines(chunk, chosen).join('\n') || t('settings.sync.webdav.conflict.emptyChoice')}</pre>
                ) : (
                  <>
                    <div className="conflict-sides">
                      <ConflictSide label={t('settings.sync.webdav.conflict.thisDevice')} lines={chunk.local} onUse={() => pick(i, 'local')} useLabel={t('settings.sync.webdav.conflict.useThisDevice')} />
                      <ConflictSide label={t('settings.sync.webdav.conflict.server')} lines={chunk.remote} onUse={() => pick(i, 'remote')} useLabel={t('settings.sync.webdav.conflict.useServer')} />
                    </div>
                    {chunk.local.length > 0 && chunk.remote.length > 0 && !sharesTaskId(chunk.local, chunk.remote) && (
                      <button className="list-toggle-btn conflict-link" onClick={() => pick(i, 'both')}>
                        {t('settings.sync.webdav.conflict.useBoth')}
                      </button>
                    )}
                    {chunk.base && chunk.base.length > 0 && (
                      <details className="conflict-base">
                        <summary>{t('settings.sync.webdav.conflict.showBase')}</summary>
                        <pre className="conflict-lines">{chunk.base.join('\n')}</pre>
                      </details>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="sync-actions" style={{ marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn-primary" disabled={!canSave || disabled} onClick={() => onSave(manual ? manualText : assembled)}>
          {t('settings.sync.webdav.conflict.saveMerged')}
        </button>
        {manual ? (
          <button className="list-toggle-btn conflict-link" onClick={() => setManualText(null)}>
            {t('settings.sync.webdav.conflict.backToChoices')}
          </button>
        ) : (
          <button className="list-toggle-btn conflict-link" onClick={() => setManualText(assembled)}>
            {t('settings.sync.webdav.conflict.editManually')}
          </button>
        )}
        {!manual && unresolved > 0 && <span className="conflict-hint">{t('settings.sync.webdav.conflict.remaining', { count: unresolved })}</span>}
        {hasMarkers && <span className="conflict-hint">{t('settings.sync.webdav.conflict.removeMarkers')}</span>}
      </div>
    </div>
  );
}

function ConflictSide({ label, lines, onUse, useLabel }: { label: string; lines: string[]; onUse: () => void; useLabel: string }) {
  const { t } = useTranslation();
  return (
    <div className="conflict-side">
      <div className="conflict-side-head">
        <span>{label}</span>
        <button className="ws-row-btn" onClick={onUse}>
          {useLabel}
        </button>
      </div>
      <pre className="conflict-lines">{lines.length > 0 ? lines.join('\n') : <em>{t('settings.sync.webdav.conflict.removedHere')}</em>}</pre>
    </div>
  );
}

function UnchangedLines({ lines }: { lines: string[] }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  if (expanded || lines.length <= COLLAPSE_OVER) return <pre className="conflict-lines is-unchanged">{lines.join('\n')}</pre>;
  const hidden = lines.length - CONTEXT_LINES * 2;
  return (
    <>
      <pre className="conflict-lines is-unchanged">{lines.slice(0, CONTEXT_LINES).join('\n')}</pre>
      <button className="list-toggle-btn conflict-link conflict-expand" onClick={() => setExpanded(true)}>
        {t('settings.sync.webdav.conflict.showUnchanged', { count: hidden })}
      </button>
      <pre className="conflict-lines is-unchanged">{lines.slice(-CONTEXT_LINES).join('\n')}</pre>
    </>
  );
}

const TASK_ID_RE = /<!--\s*id:(\S+)\s*-->/g;

/** "Keep both" would duplicate a task whose line both sides edited — two
 * lines carrying the same `<!-- id:... -->` — so it isn't offered then. */
function sharesTaskId(a: string[], b: string[]): boolean {
  const ids = new Set(a.flatMap((line) => [...line.matchAll(TASK_ID_RE)].map((m) => m[1])));
  return b.some((line) => [...line.matchAll(TASK_ID_RE)].some((m) => ids.has(m[1])));
}

function pickedLines(chunk: Extract<MergeChunk, { kind: 'conflict' }>, choice: Pick): string[] {
  if (choice === 'local') return chunk.local;
  if (choice === 'remote') return chunk.remote;
  return [...chunk.local, ...chunk.remote];
}

/** The full merged text: every chosen spot filled in, and any still-open one
 * written as git-style conflict markers (what "Edit manually" starts from). */
function assemble(chunks: MergeChunk[], picks: (Pick | null)[], labels: { local: string; remote: string }): string {
  const lines: string[] = [];
  chunks.forEach((chunk, i) => {
    if (chunk.kind === 'ok') {
      lines.push(...chunk.lines);
      return;
    }
    const choice = picks[i];
    if (choice) lines.push(...pickedLines(chunk, choice));
    else lines.push(`<<<<<<< ${labels.local}`, ...chunk.local, '=======', ...chunk.remote, `>>>>>>> ${labels.remote}`);
  });
  return lines.join('\n');
}
