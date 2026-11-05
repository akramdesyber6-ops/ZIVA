'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const logoPath = path.join(root, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-512@2x.png');
const splashDirectory = path.join(root, 'ios', 'App', 'App', 'Assets.xcassets', 'Splash.imageset');
const logoShape = [[92,138],[420,138],[420,196],[191,374],[422,374],[422,436],[90,436],[90,378],[320,200],[92,200]];

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function insidePolygon(x, y, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const [xi, yi] = polygon[index];
    const [xj, yj] = polygon[previous];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function png(width, height, splash = false) {
  const rows = Buffer.alloc((width * 4 + 1) * height);
  const scale = splash ? width * 0.38 / 512 : width / 512;
  const centerX = width / 2;
  const centerY = height / 2;
  const transform = ([x, y]) => splash
    ? [centerX + (x - 256) * scale, centerY + (y - 263) * scale]
    : [x * scale, y * scale];
  const polygon = logoShape.map(transform);
  const xs = polygon.map(([x]) => x);
  const ys = polygon.map(([, y]) => y);
  const left = Math.max(0, Math.floor(Math.min(...xs)));
  const right = Math.min(width, Math.ceil(Math.max(...xs)));
  const top = Math.max(0, Math.floor(Math.min(...ys)));
  const bottom = Math.min(height, Math.ceil(Math.max(...ys)));
  const circle = transform([385, 127]);
  const radius = 36 * scale;
  const orange = [255, 95, 31, 255];
  const gold = [255, 215, 0, 255];

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    rows[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowStart + 1 + x * 4;
      rows[offset] = 18;
      rows[offset + 1] = 18;
      rows[offset + 2] = 19;
      rows[offset + 3] = 255;
    }
  }

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      if (!insidePolygon(x + 0.5, y + 0.5, polygon)) continue;
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      rows.set(orange, offset);
    }
  }
  const circleLeft = Math.max(0, Math.floor(circle[0] - radius));
  const circleRight = Math.min(width, Math.ceil(circle[0] + radius));
  const circleTop = Math.max(0, Math.floor(circle[1] - radius));
  const circleBottom = Math.min(height, Math.ceil(circle[1] + radius));
  for (let y = circleTop; y < circleBottom; y += 1) {
    for (let x = circleLeft; x < circleRight; x += 1) {
      if ((x + 0.5 - circle[0]) ** 2 + (y + 0.5 - circle[1]) ** 2 > radius ** 2) continue;
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      rows.set(gold, offset);
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function write(file, image) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, image);
}

if (!fs.existsSync(path.dirname(logoPath))) {
  throw new Error('Capacitor iOS project is missing. Run `npx cap add ios` on a configured project first.');
}

write(logoPath, png(1024, 1024));
write(path.join(splashDirectory, 'splash-2732x2732-2.png'), png(2732, 2732, true));
write(path.join(splashDirectory, 'splash-2732x2732-1.png'), png(1366, 1366, true));
write(path.join(splashDirectory, 'splash-2732x2732.png'), png(910, 910, true));
console.log('Generated ZIVA iOS app icon and splash assets.');
