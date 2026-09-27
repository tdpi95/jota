// Encrypted-token format + crypto (milestone 31, PLAN.md "Encryption").
// Pure WebCrypto, no React/DOM — also runs as-is under Node (globalThis.crypto).
// Encryption only ever happens in the renderer; the server, index, git
// history, sync and MCP only see the token below.
//
// An encrypted span is one inline code span, in place of the text it hides
// (a whole note/entry is just a body consisting of one token):
//
//   `jota-enc:v1:pbkdf2-sha256:600000:<salt-b64>:<iv-b64>:<ciphertext-b64>`
//
// Key = PBKDF2-SHA256(passphrase UTF-8, salt, iterations) → 256-bit AES-GCM
// key; plaintext is UTF-8, no additional data; the ciphertext has its 16-byte
// GCM tag appended. Salt is 16 random bytes, IV 12 random bytes — tokens
// encrypted in one unlocked session share that session's salt (so one
// derivation covers them all) but never an IV.

export const ENCRYPTED_TOKEN_PREFIX = 'jota-enc:';
/** Must stay in sync with server/src/lib/markdown/encrypted.ts. */
export const ENCRYPTED_TOKEN_RE = /`(jota-enc:[^`\n]*)`/g;

const VERSION = 'v1';
const KDF = 'pbkdf2-sha256';
export const PBKDF2_ITERATIONS = 600_000;

export class DecryptError extends Error {
  constructor(
    message: string,
    /** 'format': not a token this version understands; 'key': wrong
     * passphrase (or tampered ciphertext — GCM can't tell them apart). */
    public readonly kind: 'format' | 'key',
  ) {
    super(message);
    this.name = 'DecryptError';
  }
}

export interface EncryptedTokenMatch {
  /** Offsets of the whole token (backticks included) within the source. */
  from: number;
  to: number;
  /** The inner `jota-enc:...` text, no backticks — the token's identity
   * (its random IV means two tokens never share it). */
  payload: string;
}

export function findEncryptedTokens(text: string): EncryptedTokenMatch[] {
  return Array.from(text.matchAll(ENCRYPTED_TOKEN_RE), (m) => ({ from: m.index!, to: m.index! + m[0].length, payload: m[1] }));
}

/** The token's payload when `text` is nothing but one encrypted token
 * (surrounding whitespace aside) — a whole note/entry encrypted as one. */
export function fullyEncryptedPayload(text: string): string | null {
  const trimmed = text.trim();
  const tokens = findEncryptedTokens(trimmed);
  return tokens.length === 1 && tokens[0].from === 0 && tokens[0].to === trimmed.length ? tokens[0].payload : null;
}

/** `text` with each encrypted token swapped for `label` — for plain-text
 * excerpts (JournalEntriesList) that would otherwise show ciphertext. */
export function redactEncryptedTokens(text: string, label: string): string {
  return text.replace(ENCRYPTED_TOKEN_RE, label);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomSalt(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(16));
}

export async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

interface ParsedPayload {
  iterations: number;
  salt: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: Uint8Array<ArrayBuffer>;
}

export function parsePayload(payload: string): ParsedPayload {
  const parts = payload.startsWith(ENCRYPTED_TOKEN_PREFIX) ? payload.slice(ENCRYPTED_TOKEN_PREFIX.length).split(':') : [];
  if (parts.length !== 6 || parts[0] !== VERSION || parts[1] !== KDF) {
    throw new DecryptError('unsupported encrypted token format', 'format');
  }
  const iterations = Number(parts[2]);
  if (!Number.isInteger(iterations) || iterations < 1) throw new DecryptError('invalid iteration count', 'format');
  try {
    return { iterations, salt: fromBase64(parts[3]), iv: fromBase64(parts[4]), ciphertext: fromBase64(parts[5]) };
  } catch {
    throw new DecryptError('encrypted token is not valid base64', 'format');
  }
}

/** Encrypts `plaintext` into a complete token, backticks included. */
export async function encryptToToken(plaintext: string, key: CryptoKey, salt: Uint8Array<ArrayBuffer>, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)));
  return '`' + ENCRYPTED_TOKEN_PREFIX + [VERSION, KDF, iterations, toBase64(salt), toBase64(iv), toBase64(ciphertext)].join(':') + '`';
}

/** Decrypts a token's payload with an already-derived key for its salt. */
export async function decryptPayload(parsed: ParsedPayload, key: CryptoKey): Promise<string> {
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: parsed.iv }, key, parsed.ciphertext);
    return new TextDecoder().decode(plain);
  } catch {
    throw new DecryptError('wrong passphrase, or the encrypted text was modified', 'key');
  }
}
