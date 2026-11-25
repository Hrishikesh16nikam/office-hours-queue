// Prints QR matrices for docs/verify-qr.py to decode independently.
import { qrMatrix } from '../web/src/qr.ts';
const base = 'https://office-hours-queue.example.workers.dev/j/K7Q4P';
const samples = ['A', base, base + '?x=' + 'y'.repeat(20), 'q'.repeat(100), 'e'.repeat(150), 't'.repeat(210), 'Snell 033 · café ✓'];
console.log(JSON.stringify(samples.map((s) => ({ s, m: qrMatrix(s).map((r) => r.map((x) => (x ? 1 : 0))) }))));
