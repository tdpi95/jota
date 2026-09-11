# UI design canvas

Source files for the app's UI prototype (Claude Design canvas): `Main.dc.html` (the interactive clickable prototype — Dashboard, Projects, Project detail, Journal, Settings, all in one artboard with internal page-switching state) and `Components.dc.html` (a static style-reference sheet — type, color, task states, badges, icons). `canvas.json` lays out both on the canvas.

**Live/editable version**: https://claude.ai/code/artifact/49bba554-eb3a-4857-8897-26263024a16e

These `.dc.html` files are the actual design content (not runnable on their own — they need the Claude Design canvas editor payload). To update the design in a future session:
1. Edit these files directly (they're plain HTML + a small template/logic format — see any `/design` skill session for the format spec).
2. Re-seed with the `design` skill's `seed-canvas.mjs` helper, pointed at this directory.
3. Republish to the URL above with the Artifact tool (`action: "publish"`, `url` set to that link) so it updates in place rather than creating a new artifact.

If these files and the live artifact ever diverge (someone edited it in the browser), pull the canvas back down first (`Artifact` tool, `action: "read"`, that URL) and re-extract with the seeding helper's `--extract` flag before making further changes here.
