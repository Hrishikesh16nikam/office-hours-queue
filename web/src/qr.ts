// A small QR code encoder (ISO/IEC 18004): byte mode, error correction
// level M, versions 1-10 (up to 213 bytes, plenty for a join link). No
// dependencies, so the projector screen works without any third-party code.

// Per version (index 1..10): total codewords, error-correction codewords per
// block, then [blocks, data codewords per block] for one or two groups.
const TABLE: [number, number, [number, number][]][] = [
  [0, 0, []],
  [26, 10, [[1, 16]]],
  [44, 16, [[1, 28]]],
  [70, 26, [[1, 44]]],
  [100, 18, [[2, 32]]],
  [134, 24, [[2, 43]]],
  [172, 16, [[4, 27]]],
  [196, 18, [[4, 31]]],
  [242, 22, [[2, 38], [2, 39]]],
  [292, 22, [[3, 36], [2, 37]]],
  [346, 26, [[4, 43], [1, 44]]],
];
const ALIGN: number[][] = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

// ---- Reed-Solomon over GF(256) ----
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data: number[], degree: number): number[] {
  const gen = rsGenerator(degree);
  const res = new Array(degree).fill(0);
  for (const d of data) {
    const factor = d ^ res.shift()!;
    res.push(0);
    for (let i = 0; i < degree; i++) res[i] ^= mul(gen[i + 1], factor);
  }
  return res;
}

// ---- encoding ----
function dataCapacity(version: number): number {
  return TABLE[version][2].reduce((s, [n, k]) => s + n * k, 0);
}

function encodeData(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const put = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const capacityBits = dataCapacity(version) * 8;
  put(0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8) bits.push(0);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; out.length < dataCapacity(version); pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

function interleave(data: number[], version: number): number[] {
  const [, ecLen, groups] = TABLE[version];
  const blocks: number[][] = [];
  let at = 0;
  for (const [n, k] of groups) for (let i = 0; i < n; i++) { blocks.push(data.slice(at, at + k)); at += k; }
  const ecBlocks = blocks.map((b) => rsRemainder(b, ecLen));
  const out: number[] = [];
  const maxData = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ecLen; i++) for (const e of ecBlocks) out.push(e[i]);
  return out;
}

// ---- matrix ----
type Grid = { size: number; dark: boolean[][]; fixed: boolean[][] };

function newGrid(version: number): Grid {
  const size = 17 + 4 * version;
  return { size, dark: Array.from({ length: size }, () => new Array(size).fill(false)), fixed: Array.from({ length: size }, () => new Array(size).fill(false)) };
}

function set(g: Grid, r: number, c: number, dark: boolean) {
  g.dark[r][c] = dark;
  g.fixed[r][c] = true;
}

function placeFunctionPatterns(g: Grid, version: number) {
  const n = g.size;
  for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const rr = r0 + r, cc = c0 + c;
      if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
      const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
      set(g, rr, cc, ring !== 2 && ring !== 4 && r >= 0 && r <= 6 && c >= 0 && c <= 6);
    }
  }
  for (let i = 8; i < n - 8; i++) {
    set(g, 6, i, i % 2 === 0);
    set(g, i, 6, i % 2 === 0);
  }
  const pos = ALIGN[version];
  const last = pos.length - 1;
  pos.forEach((r, i) => pos.forEach((c, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return; // finder corners
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(g, r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }));
  set(g, n - 8, 8, true); // the dark module
  // Reserve format areas (filled later).
  for (let i = 0; i < 9; i++) {
    if (!g.fixed[8][i]) set(g, 8, i, false);
    if (!g.fixed[i][8]) set(g, i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    if (!g.fixed[8][n - 1 - i]) set(g, 8, n - 1 - i, false);
    if (!g.fixed[n - 1 - i][8]) set(g, n - 1 - i, 8, false);
  }
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) === 1;
      const a = n - 11 + (i % 3), b = Math.floor(i / 3);
      set(g, a, b, bit);
      set(g, b, a, bit);
    }
  }
}

function placeData(g: Grid, codewords: number[]) {
  const n = g.size;
  let bit = 0;
  const total = codewords.length * 8;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? n - 1 - vert : vert;
        if (g.fixed[r][c]) continue;
        if (bit < total) g.dark[r][c] = ((codewords[bit >>> 3] >>> (7 - (bit & 7))) & 1) === 1;
        bit++;
      }
    }
  }
}

const MASKS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function applyMask(g: Grid, mask: number): boolean[][] {
  return g.dark.map((row, r) => row.map((d, c) => (g.fixed[r][c] ? d : d !== MASKS[mask](r, c))));
}

function placeFormat(m: boolean[][], mask: number) {
  const n = m.length;
  const data = (0b00 << 3) | mask; // error correction level M = 00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  // First copy, around the top-left finder.
  for (let i = 0; i <= 5; i++) m[i][8] = bit(i);
  m[7][8] = bit(6);
  m[8][8] = bit(7);
  m[8][7] = bit(8);
  for (let i = 9; i < 15; i++) m[8][14 - i] = bit(i);
  // Second copy, split between the top-right and bottom-left finders.
  for (let i = 0; i < 8; i++) m[8][n - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) m[n - 15 + i][8] = bit(i);
  m[n - 8][8] = true;
}

function penalty(m: boolean[][]): number {
  const n = m.length;
  let score = 0;
  const lines = (get: (i: number, j: number) => boolean) => {
    for (let i = 0; i < n; i++) {
      let run = 1;
      for (let j = 1; j <= n; j++) {
        if (j < n && get(i, j) === get(i, j - 1)) run++;
        else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      for (let j = 0; j + 10 < n; j++) {
        const s = Array.from({ length: 11 }, (_, k) => (get(i, j + k) ? '1' : '0')).join('');
        if (s === '10111010000' || s === '00001011101') score += 40;
      }
    }
  };
  lines((i, j) => m[i][j]);
  lines((i, j) => m[j][i]);
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
    const v = m[r][c];
    if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
  }
  const dark = m.flat().filter(Boolean).length;
  score += Math.floor(Math.abs((dark * 20) / (n * n) - 10)) * 10;
  return score;
}

/** Encodes text as a QR code. Returns rows of modules (true = dark). */
export function qrMatrix(textValue: string): boolean[][] {
  const bytes = new TextEncoder().encode(textValue);
  let version = 1;
  while (version <= 10 && dataCapacity(version) < bytes.length + (version < 10 ? 2 : 3)) version++;
  if (version > 10) throw new Error('text too long for a QR code');
  const codewords = interleave(encodeData(bytes, version), version);
  const g = newGrid(version);
  placeFunctionPatterns(g, version);
  placeData(g, codewords);
  let best: boolean[][] = [];
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = applyMask(g, mask);
    placeFormat(m, mask);
    const s = penalty(m);
    if (s < bestScore) { bestScore = s; best = m; }
  }
  return best;
}

/** An SVG path ("d" attribute) drawing the dark modules, one unit per module. */
export function qrPath(m: boolean[][]): string {
  let d = '';
  m.forEach((row, r) => row.forEach((dark, c) => { if (dark) d += `M${c} ${r}h1v1h-1z`; }));
  return d;
}
