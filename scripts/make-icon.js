'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
const SS = 3; 

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }


function hex(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}
const C_BG_TOP = hex('#1b2740');
const C_BG_BOT = hex('#0d1424');
const C_ORANGE = hex('#f38020');
const C_ORANGE_LT = hex('#ff9a3d');
const C_DARK = hex('#0d1424');
const C_WHITE = [255, 255, 255];


function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = clamp(x, x0 + r, x1 - r);
  const cy = clamp(y, y0 + r, y1 - r);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}
function inCircle(x, y, cx, cy, r) {
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}
function ringDist(x, y, cx, cy) {
  return Math.abs(Math.hypot(x - cx, y - cy));
}


function sample(px, py) {
  const x = px + 0.5, y = py + 0.5;
  let bg = inRoundedRect(x, y, 8, 8, 248, 248, 56);
  let r = 0, g = 0, b = 0, a = 0;
  if (bg) {
    const t = (y - 8) / 240;
    r = lerp(C_BG_TOP[0], C_BG_BOT[0], t);
    g = lerp(C_BG_TOP[1], C_BG_BOT[1], t);
    b = lerp(C_BG_TOP[2], C_BG_BOT[2], t);
    a = 255;
  }

  const cx = 128, cy = 132;

  const cloudCx = 150, cloudCy = 40;
  const cloud = (() => {

    const c1 = inCircle(x, y, cloudCx - 14, cloudCy + 6, 14);
    const c2 = inCircle(x, y, cloudCx + 6, cloudCy - 2, 18);
    const c3 = inCircle(x, y, cloudCx + 16, cloudCy + 8, 12);
    const rect = x >= cloudCx - 14 && x <= cloudCx + 16 && y >= cloudCy + 2 && y <= cloudCy + 14;
    return c1 || c2 || c3 || rect;
  })();
  if (cloud) { r = C_WHITE[0]; g = C_WHITE[1]; b = C_WHITE[2]; a = 255; return [r, g, b, a]; }


  const d = Math.hypot(x - cx, y - cy);
  if (d <= 66 && d >= 46) {
    const t = (d - 46) / 20;
    r = lerp(C_ORANGE[0], C_ORANGE_LT[0], t);
    g = lerp(C_ORANGE[1], C_ORANGE_LT[1], t);
    b = lerp(C_ORANGE[2], C_ORANGE_LT[2], t);
    a = 255;
    return [r, g, b, a];
  }

  if (d < 46) {
    r = C_DARK[0]; g = C_DARK[1]; b = C_DARK[2]; a = 255;
  
    if (Math.abs(d - 30) <= 1.5) {
      const k = 0.35;
      r = lerp(r, C_ORANGE[0], k); g = lerp(g, C_ORANGE[1], k); b = lerp(b, C_ORANGE[2], k);
    }
   
    if (d <= 15) {
      r = C_ORANGE[0]; g = C_ORANGE[1]; b = C_ORANGE[2];
    }
    return [r, g, b, a];
  }
  return [r, g, b, a];
}


const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function buildPng(pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;  
  ihdr[9] = 6;  
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; 
    for (let x = 0; x < SIZE; x++) {
      const o = y * (SIZE * 4 + 1) + 1 + x * 4;
      const p = pixels[y * SIZE + x];
      raw[o] = p[0]; raw[o + 1] = p[1]; raw[o + 2] = p[2]; raw[o + 3] = p[3];
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

    
const pixels = new Array(SIZE * SIZE);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let acc = [0, 0, 0, 0];
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const c = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
        acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; acc[3] += c[3];
      }
    }
    const n = SS * SS;
    pixels[y * SIZE + x] = [Math.round(acc[0] / n), Math.round(acc[1] / n), Math.round(acc[2] / n), Math.round(acc[3] / n)];
  }
}

const outDir = path.join(__dirname, '..', 'build');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'icon.png');
fs.writeFileSync(out, buildPng(pixels));
console.log('yazildi:', out, fs.statSync(out).size, 'byte');
