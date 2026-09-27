// Encrypted tokens (milestone 31, PLAN.md "Encryption") — the server never
// decrypts anything and never sees a passphrase; encryption/decryption is
// renderer-only (client/src/lib/encryptionCrypto.ts). The server's only jobs
// are recognizing a token so ciphertext never lands in the search index,
// and refusing an MCP write that would drop or alter one (an agent can't
// read the plaintext, so it can't legitimately rewrite it either).
//
// A token is one inline code span, in place of the text it hides:
//
//   `jota-enc:v1:pbkdf2-sha256:600000:<salt-b64>:<iv-b64>:<ciphertext-b64>`
//
// Must stay in sync with ENCRYPTED_TOKEN_RE in client/src/lib/encryptionCrypto.ts.

export const ENCRYPTED_TOKEN_RE = /`(jota-enc:[^`\n]*)`/g;

/** Every encrypted token's full text (backticks included), in document order. */
export function listEncryptedTokens(body: string): string[] {
  return Array.from(body.matchAll(ENCRYPTED_TOKEN_RE), (m) => m[0]);
}

/** The body with every encrypted token removed — what the search index
 * stores in place of the raw body, so ciphertext is never matched or shown
 * as a snippet. */
export function stripEncryptedTokens(body: string): string {
  return body.replace(ENCRYPTED_TOKEN_RE, '');
}

/** The encrypted tokens in `previous` that don't appear verbatim in `next`
 * — an MCP write is rejected whenever this is non-empty. */
export function missingEncryptedTokens(previous: string, next: string): string[] {
  const kept = new Set(listEncryptedTokens(next));
  return listEncryptedTokens(previous).filter((token) => !kept.has(token));
}

/** An origin tag (`[mcp:<tool>]`, see vaultGit.ts) from the MCP front door. */
export function isMcpOrigin(origin: string): boolean {
  return origin.startsWith('mcp');
}

export const ENCRYPTED_TOKEN_GUARD_MESSAGE =
  'body would remove or alter encrypted text (a `jota-enc:...` inline code span) — encrypted content can only be ' +
  'changed from the Jota app; keep every such span byte-for-byte unchanged in the new body';
