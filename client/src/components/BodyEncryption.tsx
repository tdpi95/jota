import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { handleRenderedAttachmentClick } from '../lib/attachments';
import { decryptToken, encryptText, ensureUnlocked, lock, useEncryptionSession } from '../lib/encryption';
import { findEncryptedTokens, fullyEncryptedPayload } from '../lib/encryptionCrypto';
import { renderMarkdownToHtml } from '../lib/renderMarkdown';
import { useWikilinkPreview } from '../lib/useWikilinks';
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
const SHOW_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const HIDE_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.9 3.9M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
  </svg>
);

/**
 * Encryption for a journal/note body (milestone 31, PLAN.md "Encryption"),
 * shared by JournalDayPage and NoteBodyEditor. Everything encrypted is an
 * inline `` `jota-enc:...` `` token sitting in the text in place of what it
 * hides — the body only ever holds tokens, never their plaintext.
 *
 * Toolbar, by what the body holds:
 * - nothing encrypted: "Encrypt" (the whole body into one token);
 * - some inline tokens: "Encrypt" plus the "Show"/"Hide" toggle;
 * - exactly one token: "Show"/"Hide" plus "Decrypt", which removes the
 *   encryption for good (saves the plain text).
 * "Show" unlocks the session — on screen only, the file is untouched: the
 * editor opens every token into editable text in place and re-encrypts it on
 * every edit (MarkdownEditor), and the preview renders tokens decrypted.
 * "Hide" locks it again. Selecting text pops up "Encrypt", or "Remove
 * encryption" on encrypted text. While locked, tokens show as chips;
 * clicking one asks for the passphrase.
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

  async function encryptAll() {
    const current = bodyRef.current;
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

  // Show/hide only unlocks or locks the session — never writes anything.
  async function toggleShown() {
    if (session.unlocked) lock();
    else await ensureUnlocked('unlock', tokens[0]?.payload);
  }

  async function removeAll() {
    const current = bodyRef.current;
    if (!fullPayload) return;
    // While locked, the passphrase prompt (titled and worded for removal)
    // is the confirmation; while unlocked, ask explicitly.
    if (session.unlocked) {
      if (!window.confirm(t('encryption.confirmRemoveAll'))) return;
    } else if (!(await ensureUnlocked('remove', fullPayload))) return;
    let plaintext: string;
    try {
      plaintext = await decryptToken(fullPayload);
    } catch {
      window.alert(t('encryption.cannotDecryptAlert'));
      return;
    }
    if (bodyRef.current !== current) return window.alert(t('encryption.changedMeanwhile'));
    onChange(plaintext);
  }

  async function unlockFor(payload?: string) {
    if (!session.unlocked) {
      await ensureUnlocked('unlock', payload ?? tokens[0]?.payload);
    } else if ((payload ? decrypted.get(payload) === 'error' : tokens.some((tok) => decrypted.get(tok.payload) === 'error')) && window.confirm(t('encryption.relockPrompt'))) {
      // A token this passphrase can't open — offer to start over with another.
      lock();
      await ensureUnlocked('unlock', payload ?? tokens.find((tok) => decrypted.get(tok.payload) === 'error')?.payload);
    }
  }

  // Links inside decrypted text count too, so they resolve once unlocked.
  const linkText = useMemo(() => [body, ...[...decrypted.values()].filter((v) => v !== 'error')].join('\n'), [body, decrypted]);
  const wikilinks = useWikilinkPreview(linkText);

  function handlePreviewClick(event: MouseEvent<HTMLElement>) {
    if (wikilinks.handleClick(event)) return;
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

  const previewHtml = renderMarkdownToHtml(body, { decrypted, labels: { locked: t('encryption.lockedPreview'), error: labels.error } }, wikilinks.preview);

  const button = (key: string, icon: ReactNode, label: string, title: string, onClick: () => void, extra?: { pressed?: boolean; disabled?: boolean }) => (
    <button
      key={key}
      type="button"
      className="ws-row-btn note-view-toggle-btn enc-toolbar-btn"
      title={title}
      aria-pressed={extra?.pressed}
      disabled={extra?.disabled}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
  const toolbar = (
    <>
      {!fullPayload &&
        button('encrypt', LOCK_ICON, t('encryption.encrypt'), t('encryption.encryptTitle'), () => void encryptAll(), { disabled: !body.trim() })}
      {tokens.length > 0 &&
        (session.unlocked
          ? button('toggle', HIDE_ICON, t('encryption.hide'), t('encryption.hideTitle'), () => void toggleShown(), { pressed: true })
          : button('toggle', SHOW_ICON, t('encryption.show'), t('encryption.showTitle'), () => void toggleShown(), { pressed: false }))}
      {fullPayload && button('remove', UNLOCK_ICON, t('encryption.decrypt'), t('encryption.decryptTitle'), () => void removeAll())}
    </>
  );

  return { toolbar, previewHtml, handlePreviewClick, editorEncryption };
}
