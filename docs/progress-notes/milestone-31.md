# Milestone 31 notes (Encryption)

[← back to PROGRESS.md](../../PROGRESS.md)

Requested by the user (2026-09-26): "add new milestone: encryption. encrypt parts or the whole journal and note. tell me which method to use before implement". I recommended a method first. The user replied "go with your recommendations", which settled four open questions:

- Scope is journal + notes only.
- MCP can't read encrypted content.
- The passphrase is entered every session, with no OS-keychain "remember".
- There's one passphrase per workspace.

The full design is in PLAN.md's "Encryption" section.

## First pass (superseded before commit)

The first build stored encrypted content as ```` ```jota-encrypted ```` fenced blocks on their own lines. It had an encrypt-selected-lines/new-block toolbar button, a placeholder block widget in the editor, and a modal to view/edit/re-save a block. The user then asked (2026-09-27): "use one button next to edit, preview button for encrypt/decrypt the whole note/journal. for inline, when user select text show a small popup button to encrypt/decrypt. use inline block, don't separate it". Nothing had been committed or used yet, so the fenced format and the modal were replaced outright rather than kept alongside.

Kept from the first pass:
- The crypto (AES-256-GCM, PBKDF2-SHA256 600k, per-token salt/IV).
- The session module and unlock dialog.
- The server-side strip + MCP guard.
- The CLI.
- One fix, the StrictMode autofocus bug below.

## Build

- **Client**
  - `lib/encryptionCrypto.ts`: pure WebCrypto (no React), covering the token regex (`` /`(jota-enc:[^`\n]*)`/g ``), `findEncryptedTokens`, `fullyEncryptedPayload`, `redactEncryptedTokens`, `deriveKey`, `encryptToToken`, `parsePayload`, `decryptPayload`, and `DecryptError` (`format` | `key`). It also runs under Node.
  - `lib/encryption.ts`: the module-level session. It holds the passphrase, a random per-session salt, a derived-key cache keyed by salt+iterations, and a plaintext cache keyed by the token payload. Idle auto-lock is 15 minutes, reset by `keydown`/`pointerdown`/`wheel`. `ensureUnlocked(mode, verifyPayload?)` is promise-based and backed by a pending-request store that `EncryptionHost` renders.
  - `components/EncryptionHost.tsx` (mounted in `AppShell`): the passphrase dialog, plus a lock on active-workspace change.
  - `components/BodyEncryption.tsx`: the `useBodyEncryption` hook, shared by `JournalDayPage` and `NoteBodyEditor`. It provides the toolbar, the selection actions, and preview rendering and click-to-unlock.
    - Toolbar: a whole-content toggle (open padlock = "Encrypt all content", or active closed padlock = "Decrypt all content" when the body is exactly one token), plus a key "lock" button only while unlocked and the body still holds a token.
    - Selection actions: `encryptRange` trims surrounding whitespace out of the token. `decryptRange` decrypts every token touching the selection, applied last-to-first.
    - While unlocked, every token in the body is decrypted in the background, and the resulting map is pushed into the editor and preview.
  - `MarkdownEditor.tsx`:
    - `encryptedTokensField`: a `StateField` of inline `Decoration.replace` widgets with `atomicRanges`, whose decrypted map is updated via a `StateEffect`. Mousedown on a widget selects the whole token.
    - `selectionPopupField`: a `showTooltip` field above any non-empty selection, showing "Encrypt", or "Decrypt" when a token is touched.
    - A `replaceRange(from, to, insert, expected)` handle, a real edit that keeps undo/cursor and fires `onChange`, and refuses if the range no longer holds `expected`.
  - `renderMarkdown.ts`: a markdown-it `code_inline` rule for `jota-enc:` spans (decrypted via `renderInline`, or a locked chip). A fully encrypted body renders its plaintext as full block markdown.
  - `JournalEntriesList.tsx`: redacts tokens to "🔒 Encrypted".
  - i18n: `encryption.*` strings in en + vi.
  - CSS: `.body-toolbar`, `.cm-enc-token.*`, `.enc-inline.*`, `.enc-whole`, `.cm-enc-popup`, and the unlock form.
- **Server**
  - `lib/markdown/encrypted.ts`: the same regex, plus `listEncryptedTokens`, `stripEncryptedTokens`, `missingEncryptedTokens`, and `isMcpOrigin`.
  - `reindex.ts`: stores `stripEncryptedTokens(body)` in the journal/notes `body` and FTS columns. `hasBody` still uses the raw body.
  - `services/journal.ts` `putJournalEntry` and `services/notes.ts` `updateNote`: return 409 when an `mcp:*` origin write loses a token.
  - `mcp/tools.ts`: the `body` parameter descriptions tell agents to keep `jota-enc:` spans verbatim.
- **`scripts/jota-decrypt.mjs`**: a standalone CLI using only the Node standard library. It also exports `decryptText`/`decryptPayload`.

## Gotchas

- **Git history keeps what was encrypted afterwards.** In the first pass's live test, plaintext stayed in the seed commit's history after that text was encrypted. You can't avoid that without rewriting history. Autosave is debounced (30 s default), so text encrypted before its first save never reaches disk as plaintext. PLAN.md documents this.
- **StrictMode autofocus bug (pre-existing, dev-only)**: `MarkdownEditor`'s one-time `didAutoFocusRef` survived StrictMode's destroy-and-recreate of the view, so the second view never got focus. That affected the quick-add-journal autofocus in dev. Fixed by resetting the flag in the view-creation effect's cleanup.
- **Full page reloads drop a pending autosave.** In testing, the browser tool's `navigate` did a full page load. The debounced save and the save-on-leave flush (which only runs on in-app navigation) never ran, so the file kept the old plaintext. That's existing autosave behavior, not encryption. The Electron app doesn't reload pages in normal use.
- Client-side cross-imports into server tests aren't possible: `server/tsconfig.json` has `rootDir: src`. The client↔server↔CLI round-trip was therefore run as a one-off tsx script rather than a committed test.
- Two passphrases are possible in one workspace if the user confirms a different one while encrypting in a body that has no tokens yet. There's no stored workspace-level verifier, because it would have to live in the vault or in `.jota/`. A token the current passphrase can't open shows "Can't decrypt with this passphrase", and clicking it in the preview offers to lock and try another.

## Verified (2026-09-27, inline design)

- `npm test -w server`: 210 pass. `lib/markdown/encrypted.test.ts` covers inline token listing/stripping (other inline code is left alone), `missingEncryptedTokens` (moved vs. dropped vs. altered), the MCP journal/note 409 guard with `api` writes still allowed, and search returning nothing for ciphertext while the surrounding plaintext is still found. Client and server `tsc --noEmit` are clean.
- Crypto round-trip (tsx script): the client `encryptToToken` output (a short word, and multi-line markdown containing backticks and Unicode) is matched and stripped by the server regex. `fullyEncryptedPayload` correctly identifies a one-token body. Client decrypt returns the originals. A wrong passphrase and a tampered ciphertext are both rejected. `scripts/jota-decrypt.mjs` (in-process and as a CLI) restores the file, and exits 1 with "wrong passphrase or modified encrypted text" on a bad passphrase.
- Live run. The user had their own dev server running on 5173/4174, so this used separate ports: a temporary vite config (5180 → 4175) and a temporary launch entry with `HOME` pointed at a scratch directory, both removed afterwards. The user's server and `~/.jota` were untouched.
  - Selected "at the secret place" and the popup showed "🔒 Encrypt". Clicking it opened the set-passphrase dialog (two fields plus a warning). The document then held the inline token, and the editor showed the plaintext in place (`cm-enc-token is-unlocked`).
  - Mousedown on the token selected it, and the popup showed "🔓 Decrypt". Clicking it restored the text.
  - "Encrypt all content" turned the body into a single token. The button then read "Decrypt all content" (active), and the preview rendered the plaintext as full block markdown.
  - Lock turned the preview into a "🔒 Encrypted — click to unlock" chip. "Decrypt all content" asked for the passphrase in one field (verified against the token): `wrong` → "Wrong passphrase.", then the correct one restored the plain body.
  - Encrypted two inline spans, "Alice" and "stays public", and locked. The editor showed two "🔒 Encrypted" chips inline.
  - After in-app navigation, the file on disk held the token inline with "Alice" absent. Search for "Alice"/"pbkdf2" returned nothing, while search for "talked" still found the entry, with the snippet missing the token. `jota-decrypt.mjs` recovered the plaintext.
  - Note: "Encrypt all content" on a new note produced the same token body, with the plaintext shown in the editor.
  - Calendar → "Show all journal entries" showed no `jota-enc` text anywhere on the page.

## Editable encrypted text (2026-09-27)

Reported by the user: "content is not back to encrypted after decrypt and restart". In the inline design, the popup's "Decrypt" replaced the token with its plaintext in the document, so the next autosave wrote plaintext to disk, and it stayed plain after a restart. Unlocking alone already showed the text without touching the file, but it was read-only, so editing encrypted text meant decrypt → edit → encrypt again, and forgetting the last step left it plain. Asked how it should work, the user picked "edit stays encrypted" over "re-encrypt on lock" and "keep, but relabel as Remove encryption".

- **Build**
  - `lib/encryptedRegions.ts` (new, pure): `findRegions` (fail-safe parsing), `sealRegions` (reuses an unedited region's previous token, each at most once, so identical regions never share a ciphertext; empty regions are dropped), `openableTokens`, `stripSentinels`.
  - `lib/encryption.ts`: `currentSealer()`, an encrypt function bound to the current session key. It keeps working for a call in flight when the session locks, and doesn't grow the plaintext cache per keystroke.
  - `MarkdownEditor.tsx`:
    - `bodyRef` is the body the document stands for. External `value` sync compares against it, not the document, and applies a minimal diff.
    - `emitBody` seals before `onChange`, stays synchronous when there are no regions, and drops stale seals by sequence number. It never emits while regions exist without a session.
    - `openKnownTokens`/`closeRegions` are programmatic rewrites outside history, and `closeRegions` also resets history via a `Compartment`.
    - `regionsField` hides the sentinels behind edge widgets (atomic) and tints the text between.
    - `keepRegionsBalanced` is a `transactionFilter`: Backspace/Delete steps over an edge, a lone sentinel removed by a wider edit is put back, and no sentinel can be inserted except by undo/redo.
    - Clipboard input/output filters strip sentinels.
    - The popup's "Encrypt" follows its range through the edits unlocking makes (opening other tokens shifts positions), and tokens inside that range merge into the new region.
    - The `replaceRange` handle is gone.
  - `BodyEncryption.tsx`: `decryptRange`/`encryptRange` are gone (the editor does region edits itself). "Encrypt all content" folds existing tokens in as plaintext. `onSealed` feeds the plaintext of tokens the editor just made into the map, so they aren't decrypted again, and the map is pruned to live tokens.
  - i18n: `decryptAll` → `removeAll` ("Remove encryption from all content"), `popupDecrypt` → `popupRemove` ("Remove encryption").
- **Verified (2026-09-27)**
  - The client `tsc` is clean and `npm test` passes 217. A tsx check of `encryptedRegions` covers unterminated/stray/nested sentinels, a sealed body holding no plaintext or sentinels, reuse with zero re-encryptions for unchanged regions, twin regions getting different tokens, and open → seal round-tripping byte-identically.
  - Live, in a scratch workspace (temporary vite config 5180 → 4175 and a launch entry with scratch `HOME`, both removed afterwards):
    - Encrypted "Alice" via the popup, then typed " and Bob" inside the region. The file held only a token, and `git log -p` had no "Bob". `jota-decrypt.mjs` gave "Met Alice and Bob at …".
    - Backspace at the region start deleted the space before it, and the region stayed intact.
    - Typing "Carol at" over a selection crossing the region end kept it all inside the region.
    - An insert containing a raw sentinel was rejected.
    - The key button closed the region to a chip. Ten real Ctrl+Z presses brought no plaintext back.
    - Reloading (session gone) showed a chip. Clicking it gave the unlock prompt, and the text reopened as an editable region with no new commit.
    - "Remove encryption" made it plain. "Encrypt all content" wrapped the whole body in one region, an edit inside it stayed a single token on disk, and the preview rendered it as `enc-whole`.

### Follow-up: removal needs a confirm (2026-09-27)

The user reported "I don't see any changes. no removing encryption, decrypted text still be saved to disk". The demo workspace's git log showed it: editing while unlocked had stayed encrypted (a token-to-token commit), but one commit swapped the fully encrypted body for plaintext. That was the padlock toolbar button, whose new meaning ("Remove encryption from all content") lived only in its tooltip. It looked and acted exactly like the old "Decrypt".

Fixes:
- On a fully encrypted body, the padlock now only unlocks while the session is locked ("Unlock to read and edit (stays encrypted)"), writing nothing.
- While unlocked, the padlock removes encryption only after a `window.confirm` explaining that it saves plain text and isn't needed for editing.
- The popup's "Remove encryption" also confirms, via `EditorEncryption.confirmRemove`.

Verified live in the scratch workspace:
- Locked, the padlock showed the unlock prompt.
- Unlocked, its title was "Remove encryption from all content". Cancelling that dialog, and the popup's dialog, left the document and the file (no new commit) encrypted.
