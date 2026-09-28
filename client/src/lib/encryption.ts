import { useSyncExternalStore } from 'react';

import { decryptPayload, deriveKey, encryptToToken, parsePayload, PBKDF2_ITERATIONS, randomSalt } from './encryptionCrypto';

/**
 * The renderer-side encryption session (milestone 31, PLAN.md "Encryption").
 * One passphrase per workspace, never persisted anywhere — held only in this
 * module's memory while unlocked, dropped on explicit lock, after
 * IDLE_LOCK_MS without user input, and whenever the active workspace changes
 * (`EncryptionHost`). Derived keys are cached per salt so a page with many
 * tokens pays the PBKDF2 cost once per distinct salt, and every token
 * encrypted during one session reuses that session's salt.
 *
 * Decrypted plaintext is cached here too (keyed by the token's payload,
 * unique thanks to its random IV) so the editor/preview don't re-decrypt on
 * every render — and it's cleared together with the passphrase on lock.
 */

export const IDLE_LOCK_MS = 15 * 60 * 1000;

interface Session {
  passphrase: string;
  salt: Uint8Array<ArrayBuffer>;
  keys: Map<string, Promise<CryptoKey>>;
  plaintexts: Map<string, string>;
}

let session: Session | null = null;
let version = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function notify() {
  version++;
  for (const l of listeners) l();
}

function saltKey(salt: Uint8Array): string {
  return Array.from(salt, (b) => b.toString(16).padStart(2, '0')).join('');
}

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = session ? setTimeout(lock, IDLE_LOCK_MS) : null;
}

function onActivity() {
  if (session) resetIdleTimer();
}

if (typeof window !== 'undefined') {
  for (const evt of ['keydown', 'pointerdown', 'wheel'] as const) window.addEventListener(evt, onActivity, { passive: true, capture: true });
}

export function isUnlocked(): boolean {
  return session !== null;
}

export function unlock(passphrase: string): void {
  session = { passphrase, salt: randomSalt(), keys: new Map(), plaintexts: new Map() };
  resetIdleTimer();
  notify();
}

export function lock(): void {
  if (!session) return;
  session = null;
  resetIdleTimer();
  notify();
}

function keyFor(s: Session, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const id = `${saltKey(salt)}:${iterations}`;
  let key = s.keys.get(id);
  if (!key) {
    key = deriveKey(s.passphrase, salt, iterations);
    s.keys.set(id, key);
  }
  return key;
}

function requireSession(): Session {
  if (!session) throw new Error('encryption session is locked');
  return session;
}

/** Encrypts `plaintext` into a full token (backticks included). */
export async function encryptText(plaintext: string): Promise<string> {
  const s = requireSession();
  const token = await encryptToToken(plaintext, await keyFor(s, s.salt, PBKDF2_ITERATIONS), s.salt);
  s.plaintexts.set(token.slice(1, -1), plaintext);
  return token;
}

/**
 * An encrypt function bound to the current session's key, or null while
 * locked — for the editor re-sealing edited regions on every keystroke. It
 * keeps working for a call already in flight when the session locks (so the
 * last edit before an idle lock still gets sealed rather than lost), and
 * doesn't add to the plaintext cache (a new token per keystroke would grow
 * it without bound; the editor already knows each region's plaintext).
 */
export function currentSealer(): ((plaintext: string) => Promise<string>) | null {
  const s = session;
  if (!s) return null;
  return async (plaintext) => encryptToToken(plaintext, await keyFor(s, s.salt, PBKDF2_ITERATIONS), s.salt);
}

/** Decrypts one token's payload (the `jota-enc:...` text, no backticks)
 * with the session passphrase. Throws `DecryptError` on a wrong passphrase. */
export async function decryptToken(payload: string): Promise<string> {
  const s = requireSession();
  const cached = s.plaintexts.get(payload);
  if (cached !== undefined) return cached;
  const parsed = parsePayload(payload);
  const plaintext = await decryptPayload(parsed, await keyFor(s, parsed.salt, parsed.iterations));
  if (session === s) s.plaintexts.set(payload, plaintext);
  return plaintext;
}

/** Checks a candidate passphrase against an existing token without
 * touching the session. */
export async function passphraseOpens(passphrase: string, payload: string): Promise<boolean> {
  try {
    const parsed = parsePayload(payload);
    await decryptPayload(parsed, await deriveKey(passphrase, parsed.salt, parsed.iterations));
    return true;
  } catch {
    return false;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-renders on lock/unlock; `version` changes on every transition so a
 * caller can use it as an effect dependency. */
export function useEncryptionSession(): { unlocked: boolean; version: number } {
  const v = useSyncExternalStore(subscribe, () => version);
  return { unlocked: session !== null, version: v };
}

// --- Unlock prompt (rendered by EncryptionHost) ---------------------------

export interface UnlockRequest {
  id: number;
  /** What the passphrase is for — the prompt's title and submit button say
   * so. 'encrypt' asks for it twice unless `verifyPayload` can confirm it;
   * 'unlock' (show on screen) and 'remove' (save as plain text) ask once and
   * check it against `verifyPayload`. */
  mode: 'encrypt' | 'unlock' | 'remove';
  /** An existing token's payload to verify the entered passphrase against. */
  verifyPayload?: string;
  resolve: (unlocked: boolean) => void;
}

let pendingRequest: UnlockRequest | null = null;
let nextRequestId = 1;
const requestListeners = new Set<() => void>();

/** Resolves true once unlocked (immediately, if already), false if the
 * user cancelled the prompt. */
export function ensureUnlocked(mode: UnlockRequest['mode'], verifyPayload?: string): Promise<boolean> {
  if (session) return Promise.resolve(true);
  pendingRequest?.resolve(false);
  return new Promise((resolve) => {
    pendingRequest = { id: nextRequestId++, mode, verifyPayload, resolve };
    for (const l of requestListeners) l();
  });
}

export function finishUnlockRequest(unlocked: boolean): void {
  const req = pendingRequest;
  pendingRequest = null;
  for (const l of requestListeners) l();
  req?.resolve(unlocked);
}

export function useUnlockRequest(): UnlockRequest | null {
  return useSyncExternalStore(
    (l) => {
      requestListeners.add(l);
      return () => requestListeners.delete(l);
    },
    () => pendingRequest,
  );
}
