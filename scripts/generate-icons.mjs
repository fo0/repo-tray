import { readFileSync, writeFileSync } from 'node:fs';

// RepoTray artwork constructed from a tile and three connected workflow nodes.
// The 64-unit geometry is the source: no existing raster/external asset is read.
const tile = { x: 4, y: 4, width: 56, height: 56, radius: 14 };
/** @type {[x1: number, y1: number, x2: number, y2: number][]} */
const links = [
  [20, 18, 20, 26],
  [20, 26, 32, 34],
  [32, 34, 44, 26],
  [44, 26, 44, 18],
  [32, 34, 32, 46],
];
/** @type {[cx: number, cy: number][]} */
const nodes = [
  [20, 18],
  [44, 18],
  [32, 46],
];
const strokeWidth = 5;
const nodeRadius = 3.5;
/** @type {[null, number[], number[]]} Indexed by the `sample` result. */
const colors = [null, [197, 236, 143], [27, 34, 25]];
const samples = 4;
const outputDirectory = new URL('../src-tauri/icons/', import.meta.url);

/**
 * @param {number} x
 * @param {number} y
 */
function inTile(x, y) {
  const cx = Math.max(
    tile.x + tile.radius,
    Math.min(x, tile.x + tile.width - tile.radius),
  );
  const cy = Math.max(
    tile.y + tile.radius,
    Math.min(y, tile.y + tile.height - tile.radius),
  );
  return (x - cx) ** 2 + (y - cy) ** 2 <= tile.radius ** 2;
}

/**
 * @param {number} x
 * @param {number} y
 * @param {[number, number, number, number]} link
 */
function onLink(x, y, [x1, y1, x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(
    0,
    Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)),
  );
  return (
    (x - x1 - t * dx) ** 2 + (y - y1 - t * dy) ** 2 <= (strokeWidth / 2) ** 2
  );
}

/**
 * @param {number} x
 * @param {number} y
 */
function sample(x, y) {
  if (!inTile(x, y)) return 0;
  if (
    links.some((link) => onLink(x, y, link)) ||
    nodes.some(([cx, cy]) => (x - cx) ** 2 + (y - cy) ** 2 <= nodeRadius ** 2)
  )
    return 2;
  return 1;
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

/**
 * @param {string} type
 * @param {Buffer} data
 */
function chunk(type, data) {
  const content = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const value of content)
    crc = (crcTable[(crc ^ value) & 255] ?? 0) ^ (crc >>> 8);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, content, checksum]);
}

// Stored DEFLATE blocks avoid compressor/version/platform-dependent output.
/** @param {Buffer} data */
function zlibStore(data) {
  /** @type {Buffer[]} */
  const parts = [Buffer.from([0x78, 0x01])];
  for (let offset = 0; offset < data.length; offset += 65535) {
    const block = data.subarray(offset, offset + 65535);
    const header = Buffer.alloc(5);
    header[0] = offset + block.length === data.length ? 1 : 0;
    header.writeUInt16LE(block.length, 1);
    header.writeUInt16LE(block.length ^ 0xffff, 3);
    parts.push(header, block);
  }
  let a = 1;
  let b = 0;
  for (const value of data) {
    a = (a + value) % 65521;
    b = (b + a) % 65521;
  }
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE(((b << 16) | a) >>> 0);
  return Buffer.concat([...parts, adler]);
}

/** @param {number} size */
function png(size) {
  const stride = 1 + size * 4;
  const pixels = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      /** @type {[number, number, number]} */
      const counts = [0, 0, 0];
      for (let sy = 0; sy < samples; sy++)
        for (let sx = 0; sx < samples; sx++)
          counts[
            sample(
              ((x + (sx + 0.5) / samples) * 64) / size,
              ((y + (sy + 0.5) / samples) * 64) / size,
            )
          ]++;
      const covered = counts[1] + counts[2];
      const rgba = covered
        ? [
            ...colors[1].map((value, channel) =>
              Math.round(
                (value * counts[1] + (colors[2][channel] ?? 0) * counts[2]) /
                  covered,
              ),
            ),
            Math.round((covered * 255) / samples ** 2),
          ]
        : [0, 0, 0, 0];
      pixels.set(rgba, y * stride + 1 + x * 4);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6; // RGBA; each scanline starts with filter 0.
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlibStore(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** @param {[size: number, image: Buffer][]} images */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(([size, image], index) => {
    const position = 6 + index * 16;
    header[position] = size === 256 ? 0 : size;
    header[position + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, position + 4);
    header.writeUInt16LE(32, position + 6);
    header.writeUInt32LE(image.length, position + 8);
    header.writeUInt32LE(offset, position + 12);
    offset += image.length;
  });
  return Buffer.concat([header, ...images.map(([, image]) => image)]);
}

function svg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect x="${tile.x}" y="${tile.y}" width="${tile.width}" height="${tile.height}" rx="${tile.radius}" fill="rgb(${colors[1]})"/>
  <g stroke="rgb(${colors[2]})" stroke-width="${strokeWidth}" stroke-linecap="round">
${links.map(([x1, y1, x2, y2]) => `    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`).join('\n')}
  </g>
  <g fill="rgb(${colors[2]})">
${nodes.map(([cx, cy]) => `    <circle cx="${cx}" cy="${cy}" r="${nodeRadius}"/>`).join('\n')}
  </g>
</svg>
`;
}

/** @type {[size: number, image: Buffer][]} */
const images = [16, 32, 48, 64, 128, 256].map((size) => [size, png(size)]);
/** @type {Map<string, Buffer>} */
const outputs = new Map([
  ...images
    .filter(([size]) => [32, 128, 256].includes(size))
    .map(
      /** @returns {[string, Buffer]} */
      ([size, data]) => [`${size}x${size}.png`, data],
    ),
  ['icon.ico', ico(images)],
  ['source.svg', Buffer.from(svg())],
]);
const check = process.argv[2] === '--check';
if (process.argv.length > (check ? 3 : 2))
  throw new Error('Usage: node scripts/generate-icons.mjs [--check]');
/** @type {string[]} */
const mismatches = [];
for (const [name, data] of outputs) {
  const destination = new URL(name, outputDirectory);
  if (!check) writeFileSync(destination, data);
  else {
    try {
      if (!readFileSync(destination).equals(data)) mismatches.push(name);
    } catch {
      mismatches.push(name);
    }
  }
}
if (mismatches.length)
  throw new Error(`Regenerate RepoTray icons: ${mismatches.join(', ')}`);
console.log(
  `${check ? 'Verified' : 'Generated'} ${outputs.size} RepoTray icon files`,
);
