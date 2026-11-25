import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { qrMatrix } from '../web/src/qr.ts';

const fingerprint = (m: boolean[][]) =>
  createHash('sha256').update(m.map((r) => r.map((x) => (x ? 1 : 0)).join('')).join('\n')).digest('hex').slice(0, 16);

test('QR codes match output verified with an independent decoder (OpenCV)', () => {
  // These matrices were decoded successfully by OpenCV; see docs/verify-qr.py.
  assert.equal(fingerprint(qrMatrix('https://office-hours-queue.example.workers.dev/j/K7Q4P')), '3c7e7d74122292b2');
  assert.equal(fingerprint(qrMatrix('Snell 033 · café ✓')), 'e2a679c1b9ef44d0');
});

test('QR size grows with content: version 1 is 21 modules, each version adds 4', () => {
  assert.equal(qrMatrix('A').length, 21);
  assert.equal(qrMatrix('x'.repeat(100)).length, 17 + 4 * 6);
  assert.throws(() => qrMatrix('x'.repeat(300)), /too long/);
});

test('every QR code has its three finder patterns', () => {
  const m = qrMatrix('https://example.com/j/ABCDE');
  const n = m.length;
  for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    for (let i = 0; i < 7; i++) {
      assert.ok(m[r][c + i] && m[r + 6][c + i] && m[r + i][c] && m[r + i][c + 6], 'finder border is dark');
    }
    assert.ok(m[r + 3][c + 3], 'finder center is dark');
  }
});
