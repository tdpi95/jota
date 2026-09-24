#!/usr/bin/env node
// Points release/Jota-latest.AppImage at whatever versioned AppImage was
// just built (electron-builder names it Jota-<version>.AppImage, which
// changes on every version bump). Anything with a fixed path to the
// AppImage — an MCP client config launching the packaged server, a
// desktop launcher, a symlink from $PATH — can target the stable
// "latest" name instead of being updated on every release.
//
// Not part of `npm run package:linux` itself (used by CI, which uploads
// the real versioned file as the release asset) — run explicitly via
// `npm run package:linux:latest` for local builds.
import { existsSync, lstatSync, readdirSync, symlinkSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const releaseDir = path.resolve(import.meta.dirname, '..', 'release');
const LINK_NAME = 'Jota-latest.AppImage';

if (!existsSync(releaseDir)) {
  console.error(`No release/ directory at ${releaseDir} — run the linux package build first.`);
  process.exit(1);
}

const candidates = readdirSync(releaseDir)
  .filter((name) => name.endsWith('.AppImage') && name !== LINK_NAME)
  .map((name) => ({ name, mtime: lstatSync(path.join(releaseDir, name)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);

if (candidates.length === 0) {
  console.error(`No .AppImage found in ${releaseDir} — run the linux package build first.`);
  process.exit(1);
}

const target = candidates[0].name;
const linkPath = path.join(releaseDir, LINK_NAME);

try {
  unlinkSync(linkPath);
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}
symlinkSync(target, linkPath);

console.log(`release/${LINK_NAME} -> ${target}`);
