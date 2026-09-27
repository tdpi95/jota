#!/usr/bin/env node
// Decrypts Jota's encrypted text (milestone 31, PLAN.md "Encryption")
// without the app — Node standard library only, so a vault stays readable
// even if Jota itself is gone.
//
//   node scripts/jota-decrypt.mjs <file.md> [more.md ...]
//
// Prints each file with every encrypted inline token replaced by its
// plaintext. The passphrase is read from JOTA_PASSPHRASE or prompted for
// (not echoed). Never writes anything to disk.
//
// Format (see client/src/lib/encryptionCrypto.ts) — one inline code span:
//   `jota-enc:v1:pbkdf2-sha256:<iterations>:<salt-b64>:<iv-b64>:<base64 of AES-256-GCM ciphertext || 16-byte tag>`
// key = PBKDF2-HMAC-SHA256(passphrase, salt, iterations, 32 bytes)

import crypto from 'node:crypto';
import fs from 'node:fs';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

const TOKEN_RE = /`(jota-enc:[^`\n]*)`/g;

export function decryptPayload(payload, passphrase, keyCache = new Map()) {
  const [prefix, version, kdf, iterationsRaw, saltB64, ivB64, dataB64] = payload.split(':');
  if (prefix !== 'jota-enc' || version !== 'v1' || kdf !== 'pbkdf2-sha256' || !dataB64) {
    throw new Error(`unsupported token format: ${payload.slice(0, 40)}…`);
  }
  const iterations = Number(iterationsRaw);
  const cacheKey = `${saltB64}:${iterations}`;
  let key = keyCache.get(cacheKey);
  if (!key) {
    key = crypto.pbkdf2Sync(passphrase, Buffer.from(saltB64, 'base64'), iterations, 32, 'sha256');
    keyCache.set(cacheKey, key);
  }
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(data.subarray(data.length - 16));
  return Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString('utf8');
}

export function decryptText(text, passphrase, keyCache = new Map()) {
  return text.replace(TOKEN_RE, (_whole, payload) => decryptPayload(payload, passphrase, keyCache));
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.startsWith(question)) rl.output.write(question);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stderr.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('usage: node scripts/jota-decrypt.mjs <file.md> [more.md ...]');
    process.exit(2);
  }
  const passphrase = process.env.JOTA_PASSPHRASE ?? (await promptHidden('Passphrase: '));
  const keyCache = new Map();
  let failed = false;
  for (const file of files) {
    try {
      if (files.length > 1) process.stdout.write(`==> ${file} <==\n`);
      process.stdout.write(decryptText(fs.readFileSync(file, 'utf8'), passphrase, keyCache));
    } catch (err) {
      failed = true;
      console.error(`${file}: ${err.message.includes('authenticate') ? 'wrong passphrase or modified encrypted text' : err.message}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
