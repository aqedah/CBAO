// 픽셀 캔버스와 2:1 등각 그리기 도구. 안티앨리어싱 없음.
export function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}
export function shade(c, f) {
  const [r, g, b] = hex(c);
  const m = v => Math.max(0, Math.min(255, Math.round(v * f)));
  return `#${[m(r), m(g), m(b)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}
export function mix(a, b, t) {
  const A = hex(a), B = hex(b);
  return `#${[0, 1, 2].map(i => Math.round(A[i] + (B[i] - A[i]) * t).toString(16).padStart(2, '0')).join('')}`;
}

export class Canvas {
  constructor(w, h) { this.w = w; this.h = h; this.data = new Uint8Array(w * h * 4); }
  set(x, y, color, alpha = 255) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const [r, g, b] = hex(color);
    if (alpha >= 255) { this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b; this.data[i + 3] = 255; return; }
    const a = alpha / 255, da = this.data[i + 3] / 255, oa = a + da * (1 - a);
    if (oa <= 0) return;
    this.data[i] = Math.round((r * a + this.data[i] * da * (1 - a)) / oa);
    this.data[i + 1] = Math.round((g * a + this.data[i + 1] * da * (1 - a)) / oa);
    this.data[i + 2] = Math.round((b * a + this.data[i + 2] * da * (1 - a)) / oa);
    this.data[i + 3] = Math.round(oa * 255);
  }
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return [0, 0, 0, 0];
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }
  rect(x, y, w, h, color, alpha) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, color, alpha); }
  hline(x0, x1, y, color, alpha) { if (x1 < x0) [x0, x1] = [x1, x0]; for (let x = x0; x <= x1; x++) this.set(x, y, color, alpha); }
  vline(x, y0, y1, color, alpha) { if (y1 < y0) [y0, y1] = [y1, y0]; for (let y = y0; y <= y1; y++) this.set(x, y, color, alpha); }
  line(x0, y0, x1, y1, color) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  /** 볼록/단순 다각형 채우기 (scanline, even-odd) */
  poly(points, color, alpha) {
    const ys = points.map(p => p[1]);
    const y0 = Math.ceil(Math.min(...ys)), y1 = Math.floor(Math.max(...ys));
    for (let y = y0; y <= y1; y++) {
      const xs = [];
      const sy = y + 0.5;
      for (let i = 0; i < points.length; i++) {
        const [ax, ay] = points[i], [bx, by] = points[(i + 1) % points.length];
        if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + (sy - ay) * (bx - ax) / (by - ay));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        for (let x = Math.ceil(xs[i] - 0.5); x < xs[i + 1] - 0.5 + 1e-9; x++) this.set(x, y, color, alpha);
      }
    }
  }
  outline(points, color) { for (let i = 0; i < points.length; i++) { const [a, b] = [points[i], points[(i + 1) % points.length]]; this.line(a[0], a[1], b[0], b[1], color); } }
  ellipse(cx, cy, rx, ry, color, alpha) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) this.set(x, y, color, alpha);
    }
  }
  blit(src, dx, dy) {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      const [r, g, b, a] = src.get(x, y);
      if (a) this.set(dx + x, dy + y, `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`, a);
    }
  }
}

/** 타일 오프셋(dx,dy) → 화면 오프셋. 2:1 등각, 타일 32×16 */
export const TW = 32, TH = 16;
export const iso = (dx, dy) => [(dx - dy) * TW / 2, (dx + dy) * TH / 2];

/**
 * 등각 상자. c = 캔버스, ax/ay = 접지 기준점(footprint 중심의 화면 좌표),
 * fw/fh = 타일 단위 footprint, height = 픽셀 높이, colors = {top,left,right,line}
 */
export function isoBox(c, ax, ay, fw, fh, height, colors, { z = 0 } = {}) {
  const P = (dx, dy, h) => { const [x, y] = iso(dx, dy); return [ax + x, ay + y - h - z]; };
  const hw = fw / 2, hh = fh / 2;
  const topN = P(-hw, -hh, height), topE = P(hw, -hh, height), topS = P(hw, hh, height), topW = P(-hw, hh, height);
  const botS = P(hw, hh, 0), botW = P(-hw, hh, 0), botE = P(hw, -hh, 0);
  c.poly([topW, topS, botS, botW], colors.left);
  c.poly([topS, topE, botE, botS], colors.right);
  c.poly([topN, topE, topS, topW], colors.top);
  if (colors.line) {
    c.outline([topN, topE, topS, topW], colors.line);
    c.line(topW[0], topW[1], botW[0], botW[1], colors.line);
    c.line(topS[0], topS[1], botS[0], botS[1], colors.line);
    c.line(topE[0], topE[1], botE[0], botE[1], colors.line);
    c.line(botW[0], botW[1], botS[0], botS[1], colors.line);
    c.line(botS[0], botS[1], botE[0], botE[1], colors.line);
  }
  return { topN, topE, topS, topW, botS, botW, botE };
}

export function isoDiamond(c, ax, ay, fw, fh, color, alpha, z = 0) {
  const P = (dx, dy) => { const [x, y] = iso(dx, dy); return [ax + x, ay + y - z]; };
  c.poly([P(-fw / 2, -fh / 2), P(fw / 2, -fh / 2), P(fw / 2, fh / 2), P(-fw / 2, fh / 2)], color, alpha);
}
