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

function UnlockDialog({ request }: { request: UnlockRequest }) {
  const { t } = useTranslation();
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  // Setting a passphrase for the first time (nothing existing to check it
  // against) asks twice — a typo here would make the content unrecoverable.
  const needsConfirm = request.mode === 'encrypt' && !request.verifyPayload;

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
    <Modal title={t(needsConfirm ? 'encryption.unlock.setTitle' : 'encryption.unlock.title')} onClose={() => finishUnlockRequest(false)}>
      <form className="enc-unlock-form" onSubmit={handleSubmit}>
        <p className="enc-unlock-hint">{t(needsConfirm ? 'encryption.unlock.setHint' : 'encryption.unlock.hint')}</p>
        <div className="form-field">
          <label htmlFor="enc-passphrase">{t('encryption.unlock.passphrase')}</label>
          <input
            id="enc-passphrase"
            type="password"
            autoFocus
            autoComplete="off"
            value={passphrase}
            onChange={(e) => {
              setPassphrase(e.target.value);
              setError(null);
            }}
          />
        </div>
        {needsConfirm && (
          <div className="form-field">
            <label htmlFor="enc-passphrase-confirm">{t('encryption.unlock.confirm')}</label>
            <input
              id="enc-passphrase-confirm"
              type="password"
              autoComplete="off"
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
            {checking ? t('encryption.unlock.checking') : t('encryption.unlock.submit')}
          </button>
          <button type="button" className="btn-secondary" onClick={() => finishUnlockRequest(false)}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
