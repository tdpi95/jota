import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent, RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { handleRenderedAttachmentClick } from '../lib/attachments';
import { decryptToken, encryptText, ensureUnlocked, lock, useEncryptionSession } from '../lib/encryption';
import { findEncryptedTokens, fullyEncryptedPayload } from '../lib/encryptionCrypto';
import { renderMarkdownToHtml } from '../lib/renderMarkdown';
import type { EditorEncryption, MarkdownEditorHandle } from './MarkdownEditor';

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
 * - One toolbar button encrypts the whole body into a single token, or
 *   decrypts it back when the body is exactly one token.
 * - Selecting text in the editor pops up "Encrypt" (the selection becomes a
 *   token) or "Decrypt" (the token(s) it touches become plain text again).
 * - While unlocked, the editor shows each token's plaintext in place
 *   (read-only) and the preview renders it; while locked both show a chip.
 */
export function useBodyEncryption({
  body,
  onChange,
  editorRef,
}: {
  body: string;
  onChange: (next: string) => void;
  editorRef: RefObject<MarkdownEditorHandle | null>;
}) {
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
      if (!(await ensureUnlocked('decrypt', fullPayload))) return;
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
    const token = await encryptText(current.trim());
    if (bodyRef.current !== current) return window.alert(t('encryption.changedMeanwhile'));
    onChange(`${token}\n`);
  }

  async function encryptRange(from: number, to: number) {
    const selected = bodyRef.current.slice(from, to);
    const inner = selected.trim();
    if (!inner) return;
    // Surrounding whitespace stays outside the token, so encrypting "a word "
    // mid-sentence keeps the sentence's spacing.
    const start = from + (selected.length - selected.trimStart().length);
    if (!(await ensureUnlocked('encrypt', tokens[0]?.payload))) return;
    const token = await encryptText(inner);
    if (!editorRef.current?.replaceRange(start, start + inner.length, token, inner)) window.alert(t('encryption.changedMeanwhile'));
  }

  async function decryptRange(from: number, to: number) {
    const touched = findEncryptedTokens(bodyRef.current).filter((tok) => tok.from < to && tok.to > from);
    if (touched.length === 0) return;
    if (!(await ensureUnlocked('decrypt', touched[0].payload))) return;
    const plaintexts: string[] = [];
    for (const tok of touched) {
      try {
        plaintexts.push(await decryptToken(tok.payload));
      } catch {
        window.alert(t('encryption.cannotDecryptAlert'));
        return;
      }
    }
    // Last to first, so the earlier tokens' offsets stay valid.
    for (let i = touched.length - 1; i >= 0; i--) {
      const tok = touched[i];
      if (!editorRef.current?.replaceRange(tok.from, tok.to, plaintexts[i], `\`${tok.payload}\``)) {
        window.alert(t('encryption.changedMeanwhile'));
        return;
      }
    }
  }

  async function unlockForPreview() {
    if (tokens.length === 0) return;
    if (!session.unlocked) {
      await ensureUnlocked('decrypt', tokens[0].payload);
    } else if (window.confirm(t('encryption.relockPrompt'))) {
      // A token this passphrase can't open — offer to start over with another.
      lock();
      await ensureUnlocked('decrypt', tokens.find((tok) => decrypted.get(tok.payload) === 'error')?.payload);
    }
  }

  function handlePreviewClick(event: MouseEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest('[data-enc-unlock]')) {
      void unlockForPreview();
      return;
    }
    handleRenderedAttachmentClick(event);
  }

  const labels = useMemo(
    () => ({
      locked: t('encryption.lockedChip'),
      error: t('encryption.cannotDecrypt'),
      encrypt: t('encryption.popupEncrypt'),
      decrypt: t('encryption.popupDecrypt'),
    }),
    [t],
  );

  const actionsRef = useRef({ encryptRange, decryptRange });
  actionsRef.current = { encryptRange, decryptRange };
  const editorEncryption = useMemo<EditorEncryption>(
    () => ({
      decrypted,
      labels,
      onSelectionAction: (action, from, to) => void (action === 'encrypt' ? actionsRef.current.encryptRange(from, to) : actionsRef.current.decryptRange(from, to)),
    }),
    [decrypted, labels],
  );

  const previewHtml = renderMarkdownToHtml(body, { decrypted, labels: { locked: t('encryption.lockedPreview'), error: labels.error } });

  const wholeLabel = fullPayload ? t('encryption.decryptAll') : t('encryption.encryptAll');
  const toolbar = (
    <>
      {session.unlocked && (
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
