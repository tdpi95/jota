import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import * as api from '../api/client';
import { finishUnlockRequest, lock, passphraseOpens, unlock, useUnlockRequest, type UnlockRequest } from '../lib/encryption';
import Modal from './Modal';

/**
 * App-wide half of the encryption session (milestone 31, PLAN.md
 * "Encryption"), mounted once in AppShell: renders the passphrase prompt
 * whenever something calls `ensureUnlocked`, and locks the session when the
 * active workspace changes (one passphrase per workspace).
 */
export default function EncryptionHost() {
  const request = useUnlockRequest();
  const activeQuery = useQuery({ queryKey: ['workspace', 'active'], queryFn: api.getActiveWorkspace });
  const activeId = activeQuery.data?.workspace?.id ?? null;
  const lastActiveIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastActiveIdRef.current !== null && lastActiveIdRef.current !== activeId) lock();
    lastActiveIdRef.current = activeId;
  }, [activeId]);

  // Keyed per request so each prompt starts with empty fields.
  return request ? <UnlockDialog key={request.id} request={request} /> : null;
}

const EYE_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const EYE_OFF_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.9 3.9M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
  </svg>
);

function UnlockDialog({ request }: { request: UnlockRequest }) {
  const { t } = useTranslation();
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  // One toggle reveals both fields — checking a typed passphrase against
  // its confirmation is the point of showing it.
  const [visible, setVisible] = useState(false);
  // Setting a passphrase for the first time (nothing existing to check it
  // against) asks twice — a typo here would make the content unrecoverable.
  const needsConfirm = request.mode === 'encrypt' && !request.verifyPayload;
  const texts = needsConfirm
    ? { title: 'setTitle', hint: 'setHint', submit: 'submitEncrypt' }
    : request.mode === 'encrypt'
      ? { title: 'encryptTitle', hint: 'hint', submit: 'submitEncrypt' }
      : request.mode === 'remove'
        ? { title: 'removeTitle', hint: 'removeHint', submit: 'submitRemove' }
        : { title: 'title', hint: 'hint', submit: 'submit' };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!passphrase) return;
    if (needsConfirm && passphrase !== confirm) {
      setError(t('encryption.unlock.mismatch'));
      return;
    }
    if (request.verifyPayload) {
      setChecking(true);
      const ok = await passphraseOpens(passphrase, request.verifyPayload);
      setChecking(false);
      if (!ok) {
        setError(t('encryption.unlock.wrong'));
        return;
      }
    }
    unlock(passphrase);
    finishUnlockRequest(true);
  }

  return (
    <Modal title={t(`encryption.unlock.${texts.title}`)} onClose={() => finishUnlockRequest(false)}>
      <form className="enc-unlock-form" onSubmit={handleSubmit}>
        <p className="enc-unlock-hint">{t(`encryption.unlock.${texts.hint}`)}</p>
        <div className="form-field">
          <label htmlFor="enc-passphrase">{t('encryption.unlock.passphrase')}</label>
          <div className="enc-passphrase-field">
            <input
              id="enc-passphrase"
              type={visible ? 'text' : 'password'}
              autoFocus
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={passphrase}
              onChange={(e) => {
                setPassphrase(e.target.value);
                setError(null);
              }}
            />
            <button
              type="button"
              className="enc-passphrase-toggle"
              title={t(visible ? 'encryption.unlock.hidePassphrase' : 'encryption.unlock.showPassphrase')}
              aria-label={t(visible ? 'encryption.unlock.hidePassphrase' : 'encryption.unlock.showPassphrase')}
              aria-pressed={visible}
              // Keep the caret in the field being typed into.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setVisible((v) => !v)}
            >
              {visible ? EYE_OFF_ICON : EYE_ICON}
            </button>
          </div>
        </div>
        {needsConfirm && (
          <div className="form-field">
            <label htmlFor="enc-passphrase-confirm">{t('encryption.unlock.confirm')}</label>
            <input
              id="enc-passphrase-confirm"
              type={visible ? 'text' : 'password'}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                setError(null);
              }}
            />
          </div>
        )}
        {needsConfirm && <p className="enc-unlock-warning">{t('encryption.unlock.noRecovery')}</p>}
        {error && <p className="field-error">{error}</p>}
        <div className="form-actions">
          <button type="submit" className="btn-primary" disabled={!passphrase || checking}>
            {checking ? t('encryption.unlock.checking') : t(`encryption.unlock.${texts.submit}`)}
          </button>
          <button type="button" className="btn-secondary" onClick={() => finishUnlockRequest(false)}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
