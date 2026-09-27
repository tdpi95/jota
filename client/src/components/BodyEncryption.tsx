import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { handleRenderedAttachmentClick } from '../lib/attachments';
import { decryptToken, encryptText, ensureUnlocked, lock, useEncryptionSession } from '../lib/encryption';
import { findEncryptedTokens, fullyEncryptedPayload } from '../lib/encryptionCrypto';
import { renderMarkdownToHtml } from '../lib/renderMarkdown';
import type { EditorEncryption } from './MarkdownEditor';

const LOCK_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);
const UNLOCK_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 7.5-2" />
  </svg>
);
// A key: "end the unlocked session", distinct from the padlock toggle.
const LOCK_SESSION_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="7.5" cy="15.5" r="4.5" />
    <path d="m10.7 12.3 9.8-9.8M17 6l3 3M14.5 8.5l2 2" />
  </svg>
);

/**
 * Encryption for a journal/note body (milestone 31, PLAN.md "Encryption"),
 * shared by JournalDayPage and NoteBodyEditor. Everything encrypted is an
 * inline `` `jota-enc:...` `` token sitting in the text in place of what it
 * hides — the body only ever holds tokens, never their plaintext.
 *
 * - One toolbar button encrypts the whole body into a single token, or —
 *   when the body is exactly one token — removes that encryption for good.
 * - While unlocked, the editor opens every token into editable text in
 *   place and re-encrypts it on every edit (MarkdownEditor), so it stays
 *   encrypted on disk; selecting text pops up "Encrypt", or "Remove
 *   encryption" on encrypted text. The preview renders tokens decrypted.
 * - While locked, both show a chip; clicking one asks for the passphrase.
 */
export function useBodyEncryption({ body, onChange }: { body: string; onChange: (next: string) => void }) {
  const { t } = useTranslation();
  const session = useEncryptionSession();
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const [decrypted, setDecrypted] = useState<Map<string, string | 'error'>>(() => new Map());
  const tokens = useMemo(() => findEncryptedTokens(body), [body]);
  const fullPayload = fullyEncryptedPayload(body);

  // Locking (explicitly, idle, or workspace switch) forgets every decrypted
  // plaintext — nothing survives it on screen.
  useEffect(() => {
    if (!session.unlocked) setDecrypted(new Map());
  }, [session.unlocked, session.version]);

  useEffect(() => {
    if (!session.unlocked) return;
    let cancelled = false;
    for (const token of tokens) {
      if (decrypted.has(token.payload)) continue;
      decryptToken(token.payload).then(
        (plaintext) => !cancelled && setDecrypted((prev) => new Map(prev).set(token.payload, plaintext)),
        () => !cancelled && setDecrypted((prev) => new Map(prev).set(token.payload, 'error')),
      );
    }
    // Every edit of encrypted text seals it into a new token — drop the
    // ones no longer in the body so the map doesn't grow per keystroke.
    if (decrypted.size > tokens.length + 16) {
      const live = new Set(tokens.map((tok) => tok.payload));
      setDecrypted((prev) => new Map([...prev].filter(([payload]) => live.has(payload))));
    }
    return () => {
      cancelled = true;
    };
    // `decrypted` deliberately omitted — each resolved token would restart
    // the loop for the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens, session.unlocked, session.version]);

  async function toggleWhole() {
    const current = bodyRef.current;
    if (fullPayload) {
      // Locked: this only unlocks, to read and edit — which never changes
      // the file. Removing the encryption is a separate, confirmed click.
      if (!session.unlocked) {
        await ensureUnlocked('decrypt', fullPayload);
        return;
      }
      if (!window.confirm(t('encryption.confirmRemoveAll'))) return;
      let plaintext: string;
      try {
        plaintext = await decryptToken(fullPayload);
      } catch {
        window.alert(t('encryption.cannotDecryptAlert'));
        return;
      }
      if (bodyRef.current !== current) return window.alert(t('encryption.changedMeanwhile'));
      onChange(plaintext);
      return;
    }
    if (!current.trim()) return;
    if (!(await ensureUnlocked('encrypt', tokens[0]?.payload))) return;
    // Encrypted parts already in the body fold into the one new token as
    // plain text (one that can't be decrypted stays a token inside it).
    let flat = current;
    for (const tok of [...findEncryptedTokens(current)].reverse()) {
      try {
        flat = flat.slice(0, tok.from) + (await decryptToken(tok.payload)) + flat.slice(tok.to);
      } catch {
        // keep it as is
      }
    }
    const token = await encryptText(flat.trim());
    if (bodyRef.current !== current) return window.alert(t('encryption.changedMeanwhile'));
    onChange(`${token}\n`);
  }

  async function unlockFor(payload?: string) {
    if (!session.unlocked) {
      await ensureUnlocked('decrypt', payload ?? tokens[0]?.payload);
    } else if ((payload ? decrypted.get(payload) === 'error' : tokens.some((tok) => decrypted.get(tok.payload) === 'error')) && window.confirm(t('encryption.relockPrompt'))) {
      // A token this passphrase can't open — offer to start over with another.
      lock();
      await ensureUnlocked('decrypt', payload ?? tokens.find((tok) => decrypted.get(tok.payload) === 'error')?.payload);
    }
  }

  function handlePreviewClick(event: MouseEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest('[data-enc-unlock]')) {
      if (tokens.length > 0) void unlockFor();
      return;
    }
    handleRenderedAttachmentClick(event);
  }

  const labels = useMemo(
    () => ({
      locked: t('encryption.lockedChip'),
      error: t('encryption.cannotDecrypt'),
      encrypt: t('encryption.popupEncrypt'),
      remove: t('encryption.popupRemove'),
    }),
    [t],
  );

  const unlockForRef = useRef(unlockFor);
  unlockForRef.current = unlockFor;
  const tokensRef = useRef(tokens);
  tokensRef.current = tokens;
  const editorEncryption = useMemo<EditorEncryption>(
    () => ({
      unlocked: session.unlocked,
      decrypted,
      labels,
      ensureUnlockedForEncrypt: () => ensureUnlocked('encrypt', tokensRef.current[0]?.payload),
      confirmRemove: () => window.confirm(t('encryption.confirmRemove')),
      onTokenClick: (payload) => void unlockForRef.current(payload),
      onSealed: (payload, plaintext) => setDecrypted((prev) => new Map(prev).set(payload, plaintext)),
    }),
    [session.unlocked, decrypted, labels, t],
  );

  const previewHtml = renderMarkdownToHtml(body, { decrypted, labels: { locked: t('encryption.lockedPreview'), error: labels.error } });

  const wholeLabel = !fullPayload ? t('encryption.encryptAll') : session.unlocked ? t('encryption.removeAll') : t('encryption.unlockAll');
  const toolbar = (
    <>
      {/* Only while there's something here it would hide — once this body's
          last token is decrypted back to plain text, locking changes nothing
          on this page. */}
      {session.unlocked && tokens.length > 0 && (
        <button type="button" className="ws-row-btn note-view-toggle-btn" title={t('encryption.lockNow')} aria-label={t('encryption.lockNow')} onClick={lock}>
          {LOCK_SESSION_ICON}
        </button>
      )}
      <button
        type="button"
        className={`ws-row-btn note-view-toggle-btn ${fullPayload ? 'is-active' : ''}`}
        title={wholeLabel}
        aria-label={wholeLabel}
        aria-pressed={Boolean(fullPayload)}
        disabled={!fullPayload && !body.trim()}
        onClick={() => void toggleWhole()}
      >
        {fullPayload ? LOCK_ICON : UNLOCK_ICON}
      </button>
    </>
  );

  return { toolbar, previewHtml, handlePreviewClick, editorEncryption };
}
