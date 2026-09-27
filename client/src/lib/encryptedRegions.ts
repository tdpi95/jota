// Editable encrypted regions (milestone 31, PLAN.md "Encryption").
//
// While the session is unlocked, the editor's *document* holds each
// decryptable token's plaintext in place, between two private-use sentinel
// characters, so it can be edited like any other text. The *body* the page
// keeps and saves is never that document: every region is sealed back into
// a token first (`sealRegions`), so plaintext never leaves the editor.
//
//   body (saved):    Met `jota-enc:v1:...` today.
//   document:        Met <OPEN>Alice<CLOSE> today   (OPEN/CLOSE = U+E000/U+E001)
//
// The sentinels never reach the body, the clipboard or disk — they only mark
// region boundaries inside a live CodeMirror document.

import { findEncryptedTokens } from './encryptionCrypto';

export const REGION_OPEN = '\uE000';
export const REGION_CLOSE = '\uE001';
const SENTINEL_RE = /[\uE000\uE001]/g;

export function stripSentinels(text: string): string {
  return text.replace(SENTINEL_RE, '');
}

export function hasSentinels(text: string): boolean {
  return text.includes(REGION_OPEN) || text.includes(REGION_CLOSE);
}

export interface Region {
  /** Offset of the opening sentinel. */
  open: number;
  /** Offset of the closing sentinel — equals the document length for a
   * region whose closing sentinel is missing (see `findRegions`). */
  close: number;
  /** The text between the sentinels (stray sentinels inside removed). */
  text: string;
}

/**
 * Regions in document order. Fails safe towards encrypting more, never
 * less: an opening sentinel with no closing one runs to the end of the
 * document, a second opening sentinel inside a region is ignored, and a
 * closing sentinel outside any region is ignored.
 */
export function findRegions(doc: string): Region[] {
  const regions: Region[] = [];
  let open = -1;
  for (let i = 0; i < doc.length; i++) {
    const ch = doc[i];
    if (ch === REGION_OPEN && open < 0) open = i;
    else if (ch === REGION_CLOSE && open >= 0) {
      regions.push({ open, close: i, text: stripSentinels(doc.slice(open + 1, i)) });
      open = -1;
    }
  }
  if (open >= 0) regions.push({ open, close: doc.length, text: stripSentinels(doc.slice(open + 1)) });
  return regions;
}

/** A region's current plaintext and the token it was last sealed into. */
export interface SealedRegion {
  text: string;
  token: string;
}

/**
 * Seals every region of `doc` into its token. A region whose text hasn't
 * changed reuses its previous token (from `previous`, each one used at most
 * once), so an unedited region saves byte-identical and two identical
 * regions never share a ciphertext. Empty regions are dropped.
 */
export async function sealRegions(
  doc: string,
  previous: readonly SealedRegion[],
  encrypt: (plaintext: string) => Promise<string>,
): Promise<{ body: string; sealed: SealedRegion[] }> {
  const reusable = new Map<string, string[]>();
  for (const r of previous) reusable.set(r.text, [...(reusable.get(r.text) ?? []), r.token]);
  const regions = findRegions(doc);
  const sealed: SealedRegion[] = [];
  let body = '';
  let pos = 0;
  for (const region of regions) {
    body += stripSentinels(doc.slice(pos, region.open));
    pos = Math.min(doc.length, region.close + 1);
    if (!region.text) continue;
    const token = reusable.get(region.text)?.shift() ?? (await encrypt(region.text));
    sealed.push({ text: region.text, token });
    body += token;
  }
  body += stripSentinels(doc.slice(pos));
  return { body, sealed };
}

/**
 * The tokens in `doc` (outside any region) whose plaintext is known, as the
 * edits that open each into a region, plus the token each region came from
 * (for `sealRegions` to reuse). A token nested inside a region's plaintext
 * stays a token — regions don't nest.
 */
export function openableTokens(
  doc: string,
  decrypted: ReadonlyMap<string, string | 'error'>,
): { changes: { from: number; to: number; insert: string }[]; sealed: SealedRegion[] } {
  const regions = findRegions(doc);
  const changes: { from: number; to: number; insert: string }[] = [];
  const sealed: SealedRegion[] = [];
  for (const token of findEncryptedTokens(doc)) {
    if (regions.some((r) => token.from > r.open && token.from < r.close)) continue;
    const plaintext = decrypted.get(token.payload);
    if (plaintext === undefined || plaintext === 'error') continue;
    const text = stripSentinels(plaintext);
    changes.push({ from: token.from, to: token.to, insert: REGION_OPEN + text + REGION_CLOSE });
    sealed.push({ text, token: doc.slice(token.from, token.to) });
  }
  return { changes, sealed };
}
