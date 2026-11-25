// Shared setup for running the app on Node: a SQLite file in ./data and
// generated secrets, created on first run.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { nodeDb } from '../src/db-node.ts';
import { generateVapidKeys, type VapidKeys } from '../src/push.ts';
import { Queue } from '../src/queue.ts';
import { randomToken } from '../src/security.ts';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = join(ROOT, 'data');

export interface LocalSecrets { pepper: string; setupCode: string; vapid: VapidKeys }

export async function localQueue(): Promise<{ queue: Queue; secrets: LocalSecrets }> {
  mkdirSync(DATA, { recursive: true });
  const file = join(DATA, 'local-secrets.json');
  let secrets: LocalSecrets;
  if (existsSync(file)) secrets = JSON.parse(readFileSync(file, 'utf8'));
  else {
    secrets = { pepper: randomToken(24), setupCode: randomToken(6), vapid: await generateVapidKeys('mailto:local@example.com') };
    writeFileSync(file, JSON.stringify(secrets, null, 2));
  }
  const queue = new Queue(nodeDb(join(DATA, 'local.db'), join(ROOT, 'migrations')), { pepper: secrets.pepper });
  return { queue, secrets };
}
