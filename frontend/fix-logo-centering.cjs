/**
 * Re-centers the Egyptian Red Crescent PNG.
 *
 * The original canvas (214×281) has the crescent content shifted RIGHT:
 *   left margin = 27px, right margin = 2px
 * This script shifts the pixel content LEFT by 13px so the bounding box
 * is horizontally centered in the canvas (margins ~14px each side).
 *
 * Run: node fix-logo-centering.js
 */
const fs = require('fs');
const zlib = require('zlib');

const PATH = 'public/Egyptian_Red_Crescent.png';
const buf = fs.readFileSync(PATH);

// ── Parse ──
let off = 8;
let width = 0, height = 0, colorType = 0;
let idat = Buffer.alloc(0);
const metaChunks = [];

while (off < buf.length) {
  const len = buf.readUInt32BE(off);
  const type = buf.toString('ascii', off + 4, off + 8);
  const data = buf.slice(off + 8, off + 8 + len);
  if (type === 'IHDR') {
    width = data.readUInt32BE(0);
    height = data.readUInt32BE(4);
    colorType = data[9];
  } else if (type === 'IDAT') {
    idat = Buffer.concat([idat, data]);
  } else if (type !== 'IEND') {
    metaChunks.push({ type, data });
  }
  if (type === 'IEND') break;
  off += 12 + len;
}

console.log('Canvas:', width + 'x' + height);

// ── Unfilter ──
const raw = zlib.inflateSync(idat);
const bpp = 4; // RGBA
const stride = width * bpp + 1;

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

const pixels = Buffer.alloc(width * height * bpp);
let prevRow = Buffer.alloc(width * bpp);

for (let y = 0; y < height; y++) {
  const filter = raw[y * stride];
  const row = raw.slice(y * stride + 1, (y + 1) * stride);
  const cur = Buffer.alloc(width * bpp);
  for (let x = 0; x < width; x++) {
    for (let i = 0; i < bpp; i++) {
      const idx = x * bpp + i;
      let v;
      const left = x > 0 ? cur[idx - bpp] : 0;
      const up = prevRow[idx];
      const upLeft = x > 0 ? prevRow[idx - bpp] : 0;
      if (filter === 0) v = row[idx];
      else if (filter === 1) v = (row[idx] + left) & 0xff;
      else if (filter === 2) v = (row[idx] + up) & 0xff;
      else if (filter === 3) v = (row[idx] + ((left + up) >> 1)) & 0xff;
      else if (filter === 4) v = (row[idx] + paeth(left, up, upLeft)) & 0xff;
      cur[idx] = v;
    }
  }
  cur.copy(pixels, y * width * bpp);
  prevRow = cur;
}

// ── Verify old bbox ──
let oldMinX = 1e9, oldMaxX = -1;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    if (pixels[(y * width + x) * bpp + 3] > 40) {
      if (x < oldMinX) oldMinX = x;
      if (x > oldMaxX) oldMaxX = x;
    }
  }
}
const oldCx = (oldMinX + oldMaxX) / 2;
const canvasCx = (width - 1) / 2;
const shift = Math.round(oldCx - canvasCx); // pixels to shift LEFT
console.log('Old bbox x:', oldMinX + '-' + oldMaxX, ' center:', oldCx.toFixed(1), ' shift:', shift + 'px');

// ── Shift content LEFT ──
const newPixels = Buffer.alloc(width * height * bpp); // transparent black
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const srcX = x + shift;
    if (srcX >= 0 && srcX < width) {
      const srcIdx = (y * width + srcX) * bpp;
      const dstIdx = (y * width + x) * bpp;
      pixels.copy(newPixels, dstIdx, srcIdx, srcIdx + bpp);
    }
  }
}

// ── Verify new bbox ──
let newMinX = 1e9, newMaxX = -1;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    if (newPixels[(y * width + x) * bpp + 3] > 40) {
      if (x < newMinX) newMinX = x;
      if (x > newMaxX) newMaxX = x;
    }
  }
}
console.log('New bbox x:', newMinX + '-' + newMaxX, ' center:', ((newMinX + newMaxX) / 2).toFixed(1), ' margin L:', newMinX, 'R:', width - 1 - newMaxX);

// ── Rebuild PNG (filter 0, level 9) ──
const newStride = width * bpp + 1;
const rawData = Buffer.alloc(height * newStride);
for (let y = 0; y < height; y++) {
  rawData[y * newStride] = 0;
  newPixels.copy(rawData, y * newStride + 1, y * width * bpp, (y + 1) * width * bpp);
}
const compressed = zlib.deflateSync(rawData, { level: 9 });

// ── CRC32 ──
const table = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let v = n;
  for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
  table[n] = v;
}
function crc32(chunk) {
  let c = 0xffffffff;
  for (let i = 0; i < chunk.length; i++) c = table[(c ^ chunk[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crcBuf]);
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdrData = Buffer.alloc(13);
ihdrData.writeUInt32BE(width, 0);
ihdrData.writeUInt32BE(height, 4);
ihdrData[8] = 8;
ihdrData[9] = colorType;
const ihdr = makeChunk('IHDR', ihdrData);
const idatChunk = makeChunk('IDAT', compressed);
const iend = makeChunk('IEND', Buffer.alloc(0));

const out = Buffer.concat([
  sig, ihdr,
  ...metaChunks.map(c => makeChunk(c.type, c.data)),
  idatChunk, iend
]);

fs.writeFileSync(PATH, out);
console.log('Wrote', out.length, 'bytes (was', buf.length, ')');
console.log('Done — crescent is now centered in the canvas');
