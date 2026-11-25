// One command to create and upload every Cloudflare secret:
//   npm run secrets -- you@example.com
// Generates fresh values, uploads them with `wrangler secret bulk`, deletes the
// temporary file, and prints only the setup code you need for first sign-in.
import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { generateVapidKeys } from '../src/push.ts';
import { randomToken } from '../src/security.ts';

const email = process.argv[2];
if (!email || !email.includes('@')) {
  console.error('Usage: npm run secrets -- you@example.com');
  process.exit(1);
}
const vapid = await generateVapidKeys(`mailto:${email}`);
const setupCode = randomToken(9);
const file = '.secrets.json';
writeFileSync(file, JSON.stringify({
  PIN_PEPPER: randomToken(32),
  SETUP_CODE: setupCode,
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_JWK: JSON.stringify(vapid.privateJwk),
  VAPID_SUBJECT: vapid.subject,
}));
try {
  const r = spawnSync('npx', ['wrangler', 'secret', 'bulk', file], { stdio: 'inherit', shell: true });
  if (r.status !== 0) throw new Error('wrangler secret bulk failed');
} finally {
  rmSync(file, { force: true });
}
console.log(`\nSecrets uploaded. Your setup code (needed once, on first sign-in): ${setupCode}\n`);
