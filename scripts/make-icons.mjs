// Draws the app icon — a basketball on a dark tile — straight to PNG with no dependencies.
// Run with `node scripts/make-icons.mjs` after changing the design. Writes into public/.
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const BG = [18, 16, 16]
const BALL = [232, 112, 42]
const SEAM = [30, 16, 8]

/** Colour at a point in the unit square, centred on 0.5. */
function shade(x, y) {
  const dx = x - 0.5
  const dy = y - 0.5
  const r = Math.hypot(dx, dy)
  const R = 0.36 // ball radius; leaves room for the maskable safe zone
  if (r > R) return BG
  const w = 0.016 // seam half-width
  const onSeam =
    Math.abs(dx) < w || // vertical seam
    Math.abs(dy) < w || // horizontal seam
    // Two curved seams: arcs of circles centred off to each side.
    Math.abs(Math.hypot(dx - 0.42, dy) - 0.3) < w ||
    Math.abs(Math.hypot(dx + 0.42, dy) - 0.3) < w ||
    r > R - w * 1.4 // outline
  if (onSeam) return SEAM
  // A little light from the top left so it reads as round.
  const light = 1 + 0.18 * (-(dx + dy) / R)
  return BALL.map((c) => Math.min(255, Math.round(c * light)))
}

function png(size) {
  const ss = 4 // supersampling for smooth edges
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0]
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const c = shade((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size)
          acc[0] += c[0]
          acc[1] += c[1]
          acc[2] += c[2]
        }
      const o = py * (size * 4 + 1) + 1 + px * 4
      raw[o] = acc[0] / ss / ss
      raw[o + 1] = acc[1] / ss / ss
      raw[o + 2] = acc[2] / ss / ss
      raw[o + 3] = 255
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function crc32(buf) {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

writeFileSync('public/icon-192.png', png(192))
writeFileSync('public/icon-512.png', png(512))
writeFileSync('public/apple-touch-icon.png', png(180))
console.log('icons written')
