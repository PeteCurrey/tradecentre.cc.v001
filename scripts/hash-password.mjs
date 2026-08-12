#!/usr/bin/env node
/**
 * Generate AUTH_PASSWORD_HASH and AUTH_SECRET for .env.local
 *
 *   node scripts/hash-password.mjs "your password here"
 *
 * Run this yourself — your password should never be pasted into a chat, a
 * commit, or anywhere it can be logged. Only the resulting hash goes in the
 * env file, and the hash cannot be reversed into the password.
 *
 * Uses scrypt with per-password random salt. Verification is constant-time.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const N = 16384; // CPU/memory cost
const r = 8;
const p = 1;
const KEYLEN = 64;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password, stored) {
  const [scheme, n, rr, pp, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt") return false;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const actual = scryptSync(password, salt, expected.length, {
    N: Number(n),
    r: Number(rr),
    p: Number(pp),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Only run the CLI when invoked directly, so the functions stay importable.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const password = process.argv[2];
  if (!password) {
    console.error('Usage: node scripts/hash-password.mjs "your password here"');
    process.exit(1);
  }
  if (password.length < 12) {
    console.error(
      `Password is ${password.length} characters. This guards a live broker\n` +
        "connection on the public internet — use at least 12.",
    );
    process.exit(1);
  }

  console.log("\nAdd these two lines to .env.local:\n");
  console.log(`AUTH_PASSWORD_HASH=${hashPassword(password)}`);
  console.log(`AUTH_SECRET=${randomBytes(32).toString("base64")}`);
  console.log(
    "\nThen clear this command from your shell history:\n  history -d $((HISTCMD-1))\n",
  );
}
