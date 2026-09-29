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

## Toolbar and popup refinement (2026-09-28)

Requested by the user: "show only one lock button if the journal/note is not encrypted. when the journal/note is encrypted, show 2 button: temporary decrypt (for edit and view on UI only), strip the encryption and save to disk… user can click the temporary decrypt button again to hide… no need a separated key button. lock and unlock button in passphrase modal should change the text based on current behavior. the inline encrypt popup button only show on key up, don't show when user is dragging the mouse."

- **Build**
  - `BodyEncryption.tsx`: the padlock toggle and the key button are replaced by labelled icon buttons (`.enc-toolbar-btn`).
    - **Encrypt** is shown unless the body is exactly one token.
    - **Show/Hide** is shown whenever the body has a token. It only unlocks or locks the session.
    - **Decrypt** is shown only for a fully encrypted body. While locked, it goes through `ensureUnlocked('remove', …)`, whose prompt is the confirmation. While unlocked, it uses the existing `confirmRemoveAll` dialog.
    - "Show"/"Hide" was picked over "Unlock"/"Lock" to match the user's wording ("hide the text"). "Decrypt" is the permanent action, and its tooltip spells out that it saves plain text.
  - `lib/encryption.ts`: `UnlockRequest.mode` is now `'encrypt' | 'unlock' | 'remove'` (`'decrypt'` was renamed to `'unlock'`). `EncryptionHost` picks the title, hint and submit label from it:
    - Setting a passphrase: "Set encryption passphrase" / "Encrypt".
    - Encrypting with an existing passphrase: "Encrypt with passphrase" / "Encrypt".
    - Showing: "Unlock encrypted content" / "Unlock".
    - Removing: "Remove encryption" / "Decrypt".
  - `MarkdownEditor.tsx`: `selectionHeldTracker`, a view plugin, reports a press (a mousedown or keydown in the editor, ignoring presses on the popup itself) and its release (mouseup, keyup or blur, watched on `window` since a drag can end outside the editor) through a `setSelectionHeld` effect. `selectionPopupField` returns no tooltip while held and recomputes on release.
  - i18n: `encryptAll`/`removeAll`/`unlockAll`/`lockNow` were replaced by `encrypt`/`show`/`hide`/`decrypt`, each with a `*Title` tooltip. Added `unlock.encryptTitle`, `removeTitle`, `removeHint`, `submitEncrypt` and `submitRemove`. Both en and vi were updated.
- **Verified (2026-09-28)**: client `tsc --noEmit` is clean. Live, in a scratch workspace (temporary vite config 5180 → 4175 and a launch entry with a scratch `HOME`, both removed afterwards):
  - A plain body showed only "Encrypt".
  - A scripted mousedown, then selecting "Alice", showed no popup. After a `window` mouseup it showed "🔒 Encrypt". Keyboard selection behaved the same between keydown and keyup.
  - Clicking the popup opened "Set encryption passphrase" with the submit button reading "Encrypt".
  - Partially encrypted, the toolbar showed "Encrypt" and "Hide". Hide turned the region into a chip and the button into "Show". Show opened "Unlock encrypted content" / "Unlock".
  - After "Encrypt" (whole), the toolbar showed "Hide" and "Decrypt". Hide changed it to "Show" and "Decrypt", and the file held only the token.
  - Decrypt while locked opened "Remove encryption" / "Decrypt". After the passphrase, the body was plain text again and the toolbar was back to just "Encrypt".

### Follow-up: encrypted text has its own color (2026-09-28)

The user asked: "use a different color for encrypted text instead of the same color as selected text". Encrypted spans had used `--accent-soft`, which is also the selection color (`::selection`, `.cm-selectionBackground`).

- **Build**: new theme tokens in `app.css`: `--enc-hue`, `--enc-soft` and `--enc-border`, with dark-theme values.
  - The hue is `calc(var(--accent-hue) + 180)`, opposite the accent, so it stays distinct from the selection under every palette. Under the default palette it's blue.
  - The wash is translucent (0.7 alpha) so CodeMirror's selection layer, drawn beneath the text, still shows through inside a region.
  - Every `.cm-enc-*` / `.enc-inline` / `.enc-whole` rule uses these tokens. The error chip keeps `--danger`.
- **Verified live** (scratch workspace, same temporary setup, removed afterwards): an open region was blue-tinted next to a peach selection in light theme, and teal next to a brown selection in dark theme.

### Follow-up: right-click to remove encryption (2026-09-28)

The user asked: "show remove encryption popup when user right click on encrypted text".

- **Build** (`MarkdownEditor.tsx`):
  - `regionContextMenu`, a `contextmenu` DOM handler, maps the click to a document position. If that position is inside an open region, it cancels the native menu and dispatches `setContextTarget`. Anywhere else the native menu is left alone.
  - `selectionPopupField` now also tracks `context`. While it's set, the popup offers "Remove encryption" at that spot, and the action goes through the same confirmed `remove(pos, pos)`. `context` is cleared by a new press (a left click elsewhere, Escape or any key), an edit, or a non-empty selection.
  - A right-click's own mousedown comes before its `contextmenu` event, so the press clears the old target and the event sets the new one.
  - It only applies to open regions (while shown). A locked chip still unlocks on click.
- **Verified live** (scratch workspace, same temporary setup, removed afterwards):
  - Right-click on an open region showed "🔓 Remove encryption", and the native menu was cancelled (`defaultPrevented` true).
  - Right-click on plain text showed no popup and kept the native menu.
  - A left click elsewhere and Escape both dismissed it.
  - Clicking it, with the confirm accepted, turned the region into plain text.

### Follow-up: the decryptor is a web page, not a Node script (2026-09-29)

The user asked: "write decryptor in html instead of mjs, not all users have node". `scripts/jota-decrypt.mjs` was replaced by `scripts/jota-decrypt.html`, and the `.mjs` is deleted.

- **Build**
  - A single file with no external resources. It's opened from disk (double-click) and uses the browser's WebCrypto.
  - Browsers treat `file://` as a secure context, so `crypto.subtle` is available there. It's missing on a `data:` URL, which is why the browser pane's file preview couldn't run it.
  - A CSP of `default-src 'none'` (inline script and style only) forbids any network request.
  - You enter the passphrase, then choose, drop, or paste files. Keys are derived once per salt.
  - Tokens are decrypted one at a time. One that fails (wrong passphrase, a different passphrase, or modified) is kept verbatim and highlighted, and the card reports "Decrypted N of M". The old CLI failed the whole file instead.
  - Copy falls back to selecting the text when the clipboard API is blocked. Save downloads `<name>.decrypted.md` and never writes over the original.
  - It has light and dark themes and works at phone width.
  - `.github/workflows/build.yml`: the release job sparse-checks-out the file and attaches it to every GitHub Release next to the installers. Otherwise users without a checkout had no way to get it.
- **Verified (2026-09-29)**, served from a temporary localhost static server (a secure context, like `file://`) with the launch entry removed afterwards. The test file held four tokens:
  - Two were made with Node's crypto under `scratch-pass`, one containing markdown, Unicode, a backtick span and a newline.
  - One was made under a different passphrase.
  - One was made by the client's own `encryptToToken` (via tsx).
  - With `scratch-pass`: "Decrypted 3 of 4". The output was byte-exact for all three, with the foreign token highlighted.
  - With a wrong passphrase: "Wrong passphrase, or the encrypted text was modified", with all 4 highlighted.
  - Pasted plain text: "No encrypted text found".
  - No console errors (CSP included), and dark theme rendered correctly.

### Follow-up: show the passphrase in the prompt (2026-09-29)

The user asked: "allow user to see the passphrase in encrypt/decrypt modal".

- **Build**
  - `EncryptionHost.tsx`'s `UnlockDialog` has an eye toggle inside the passphrase field (`.enc-passphrase-field` / `.enc-passphrase-toggle`, with en/vi `showPassphrase`/`hidePassphrase` labels and `aria-pressed`).
  - One `visible` state switches both the passphrase and the confirm field between `password` and `text`, since comparing the two is the point of revealing them.
  - The dialog is keyed per request, so every prompt starts hidden. The toggle's `mousedown` is prevented so the caret stays in the field.
  - The fields turn off autocapitalize, autocorrect and spellcheck, so a revealed passphrase isn't underlined or altered.
  - `.form-field input[type="password"]` joined the shared input rule. Password inputs had been falling back to browser defaults, and without the rule the field would have changed look when toggled.
- **Verified live** (scratch workspace, same temporary setup, removed afterwards):
  - On "Set encryption passphrase", the toggle switched both fields to text and back.
  - After typing in the confirm field and toggling, focus was still on the confirm field, and Enter encrypted (the toolbar showed Hide/Decrypt).
  - The single-field "Unlock" prompt opened hidden, and the toggle rendered correctly in dark theme.
