# App icon design canvas

**Current shipped icon**: a supplied raster illustration (colorful sticky
notes arranged into a thought-bubble/brain shape), not derived from any
`.dc.html` file below. Two source masters, both under `source/`:
- `thought-bubble-master.png` (1254×1254, paper texture + background) —
  `electron/build/icon.png` (1024) and `electron/src/assets/icon.png` (512)
  are plain Lanczos downscales of it, no re-render step needed.
- `thought-bubble-flat-transparent.png` (1536×1024, flat colors, true alpha
  transparency, no paper texture/background) — used for the small sizes
  where the textured master turned to mud: `electron/src/assets/tray-icon.png`
  (16×16) and `tray-icon@2x.png` (32×32). Made by padding the source to a
  1536×1536 transparent square (`convert src -gravity center -background
  none -extent 1536x1536`) then Lanczos-downscaling with `-background none
  -gravity center -extent <N>x<N>` to keep alpha.

To swap either again, replace the relevant file under `source/` and re-run
the matching resize above.

Source files for the *previous* shipped design (Claude Design canvas):
`Main.dc.html` was that design — "Stacked Tiles," three overlapping
rounded-square tiles (sized from poco's own paper/accent-soft/today-bg color
tokens) ascending small-to-large toward the top-right, like a thought bubble
building up. `DirectionB.dc.html` ("Folded Note") and `DirectionC.dc.html`
(a geometric "p" glyph) are the two alternates explored alongside it — kept
for reference, not shipped. `canvas.json` lays out all three with
sticky-note annotations explaining each direction's rationale/tradeoff.
These are now historical (superseded by the raster above) but still the
source for the tray icons, which still use the old flat design.

**Live/editable version**: https://claude.ai/code/artifact/7e744a89-1fef-4646-8186-f63a58ae86df

These `.dc.html` files are the actual design content (not runnable on their
own — they need the Claude Design canvas editor payload). To update the
design in a future session:
1. Edit `Main.dc.html` directly (plain HTML + a small template/logic format
   — see any `/design` skill session for the format spec).
2. Re-seed with the `design` skill's `seed-canvas.mjs` helper, pointed at
   this directory.
3. Republish to the URL above with the Artifact tool (`action: "publish"`,
   `url` set to that link) so it updates in place rather than creating a
   new artifact.
4. Re-render the raster assets actually shipped in `electron/` (below) —
   editing this canvas alone does not update them.

If these files and the live artifact ever diverge (someone edited it in
the browser), pull the canvas back down first (`Artifact` tool,
`action: "read"`, that URL) and re-extract with the seeding helper's
`--extract` flag before making further changes here.

## Regenerating the shipped PNGs

`electron/build/icon.png`, `electron/src/assets/icon.png`, and the
`tray-icon*.png` pair are rasterized separately — the canvas editor doesn't
export at these exact sizes/variants. After editing `Main.dc.html`'s
`<svg>`/colors, reproduce them with a plain HTML page at real pixel size
(the `.dc.html` wrapper itself needs the design-canvas runtime and can't be
screenshotted directly) and headless Chrome, which renders the `oklch()`
colors natively:

```bash
# 1. Copy Main.dc.html's <div style="width:512px...">...</div> (the frame +
#    <svg>) into a standalone page sized to the master resolution:
cat > render-master.html << 'EOF'
<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0}
.frame{width:1024px;height:1024px;background:oklch(58% 0.15 45);display:flex;align-items:center;justify-content:center}
</style></head><body><div class="frame">
  <!-- paste the <svg>...</svg> from Main.dc.html here, unchanged -->
</div></body></html>
EOF

# 2. Screenshot it at exactly that size:
google-chrome --headless --disable-gpu --hide-scrollbars \
  --screenshot=icon-master-1024.png --window-size=1024,1024 \
  file://$(pwd)/render-master.html

# 3. Downscale with Lanczos filtering for the smaller variants:
convert icon-master-1024.png -filter Lanczos -resize 512x512 icon-512.png   # -> electron/src/assets/icon.png
# icon-master-1024.png itself -> electron/build/icon.png (electron-builder's
# icns/ico source, once packaging config is wired up)
```

For the tray icons (`electron/src/assets/tray-icon.png` 16×16 and
`tray-icon@2x.png` 32×32), drop the `<filter>`/drop-shadow first — it just
reads as blur at that size — then render and downscale the same way from a
512×512 master. Electron picks up the `@2x` sibling automatically for
HiDPI trays; no code change needed when only the image content changes.
