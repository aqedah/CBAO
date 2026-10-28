// 픽셀 에셋 아틀라스 생성기. 실행: node tools/pixel-art/build-atlas.mjs
// 결과: public/pixel-office/atlas.png, atlas.json, preview.png (검수용 미리보기)
// 모든 프레임은 코드로 그린 원본(이 저장소 저작, 외부 이미지 사용 없음).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas } from './canvas.mjs';
import { encodePNG } from './png.mjs';
import * as F from './furniture.mjs';
import { drawAvatar, CHARACTERS, CLIPS } from './avatar.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../../public/pixel-office');
fs.mkdirSync(outDir, { recursive: true });

const PAD = 2;      // 투명 여백
const EXTRUDE = 1;  // 가장자리 복제 (색 번짐 방지)
const frames = []; // {name, canvas, anchor:[ax,ay] (정규화)}
const add = (name, canvas, anchor) => frames.push({ name, canvas, anchor });

// 1. 바닥·벽
add('floor-wood/0', F.floorTile(0), [0.5, 0.5]);
add('floor-wood/1', F.floorTile(1), [0.5, 0.5]);
add('wall-nw/plain', F.wallPanel('nw', 'plain'), [0.5, 88 / 96]);
add('wall-nw/window', F.wallPanel('nw', 'window'), [0.5, 88 / 96]);
add('wall-ne/plain', F.wallPanel('ne', 'plain'), [0.5, 88 / 96]);
add('wall-ne/window', F.wallPanel('ne', 'window'), [0.5, 88 / 96]);

// 2. 책상 (rear / chair / front)
const desk = F.deskParts();
add('desk-standard/rear', desk.rear, [0.5, 0.875]);
add('desk-standard/chair', desk.chair, [0.5, 0.875]);
add('desk-standard/front', desk.front, [0.5, 0.875]);

// 3. 소품
add('bookshelf/0', F.bookshelf(), [0.5, 0.875]);
add('task-board/0', F.taskBoard(), [0.5, 0.875]);
add('meeting-table/0', F.meetingTable(), [0.5, 0.875]);
add('owner-desk/0', F.ownerDesk(), [0.5, 0.875]);
add('sofa/0', F.sofa(), [0.5, 96 / 112]);
add('coffee-station/0', F.coffeeStation(), [0.5, 96 / 112]);
add('plant-large/0', F.plant(0), [0.5, 84 / 96]);
add('plant-large/1', F.plant(1), [0.5, 84 / 96]);
add('rug/0', F.rug(), [0.5, 84 / 96]);
add('runner-console/0', F.runnerConsole(), [0.5, 84 / 96]);
add('floor-lamp/0', F.floorLamp(), [0.5, 100 / 112]);

// 4. 캐릭터 5명 × 클립
for (const key of Object.keys(CHARACTERS)) {
  for (const [clip, n] of Object.entries(CLIPS)) {
    for (let i = 0; i < n; i++) add(`avatar-${key}/${clip}/${i}`, drawAvatar(key, clip, i), [0.5, 0.9]);
  }
}

// 5. 패킹 (shelf packing, 높이 순)
const W = 1024;
const sorted = [...frames].sort((a, b) => b.canvas.h - a.canvas.h || b.canvas.w - a.canvas.w);
let x = PAD, y = PAD, rowH = 0;
for (const f of sorted) {
  const w = f.canvas.w + EXTRUDE * 2, h = f.canvas.h + EXTRUDE * 2;
  if (x + w + PAD > W) { x = PAD; y += rowH + PAD; rowH = 0; }
  f.x = x + EXTRUDE; f.y = y + EXTRUDE;
  x += w + PAD; rowH = Math.max(rowH, h);
}
const H = Math.pow(2, Math.ceil(Math.log2(y + rowH + PAD)));
const atlas = new Canvas(W, H);
for (const f of sorted) {
  atlas.blit(f.canvas, f.x, f.y);
  // extrude: 가장자리 1px 복제
  for (let i = 0; i < f.canvas.w; i++) {
    for (const [sy, dy] of [[0, -1], [f.canvas.h - 1, f.canvas.h]]) {
      const [r, g, b, a] = f.canvas.get(i, sy); if (a) atlas.set(f.x + i, f.y + dy, `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`, a);
    }
  }
  for (let j = 0; j < f.canvas.h; j++) {
    for (const [sx, dx] of [[0, -1], [f.canvas.w - 1, f.canvas.w]]) {
      const [r, g, b, a] = f.canvas.get(sx, j); if (a) atlas.set(f.x + dx, f.y + j, `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`, a);
    }
  }
}
fs.writeFileSync(path.join(outDir, 'atlas.png'), encodePNG(W, H, atlas.data));

const json = {
  frames: Object.fromEntries(sorted.map(f => [f.name, { frame: { x: f.x, y: f.y, w: f.canvas.w, h: f.canvas.h }, anchor: { x: f.anchor[0], y: f.anchor[1] } }])),
  animations: Object.fromEntries(Object.keys(CHARACTERS).flatMap(key => Object.entries(CLIPS).map(([clip, n]) => [`avatar-${key}/${clip}`, Array.from({ length: n }, (_, i) => `avatar-${key}/${clip}/${i}`)]))),
  meta: {
    image: 'atlas.png', size: { w: W, h: H }, scale: '1', format: 'RGBA8888',
    generator: 'tools/pixel-art/build-atlas.mjs',
    license: 'CC0-1.0 — 이 저장소에서 코드로 생성한 원본 픽셀아트. 외부 이미지·생성형 이미지 미사용.',
    desk_avatar_offset: { x: Math.round(desk.avatarOffset[0]), y: Math.round(desk.avatarOffset[1]) },
    clips: Object.fromEntries(Object.entries(CLIPS).map(([k, n]) => [k, { frames: n, fps: { idle: 4, typing: 6, reading: 4, waiting: 2, still: 0 }[k] }])),
  },
};
fs.writeFileSync(path.join(outDir, 'atlas.json'), JSON.stringify(json, null, 2));

// 6. 검수용 미리보기: 책상+의자+캐릭터 조합을 3배로 확대
const prev = new Canvas(1024, 720);
prev.rect(0, 0, 1024, 720, '#d7ab78');
let px = 10;
for (const key of Object.keys(CHARACTERS)) {
  const comp = new Canvas(128, 128);
  comp.blit(desk.rear, 0, 0); comp.blit(desk.chair, 0, 0);
  comp.blit(drawAvatar(key, 'typing', 0), 64 + Math.round(desk.avatarOffset[0]) - 32, 112 + Math.round(desk.avatarOffset[1]) - 72);
  comp.blit(desk.front, 0, 0);
  for (let j = 0; j < 128; j++) for (let i = 0; i < 128; i++) {
    const [r, g, b, a] = comp.get(i, j); if (!a) continue;
    const col = `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
    prev.rect(px + i * 2, 10 + j * 2, 2, 2, col, a);
  }
  // 클립별 1프레임
  let cy = 280;
  for (const clip of Object.keys(CLIPS)) {
    const fr = drawAvatar(key, clip, 1 % CLIPS[clip]);
    for (let j = 0; j < 80; j++) for (let i = 0; i < 64; i++) { const [r, g, b, a] = fr.get(i, j); if (a) prev.set(px + 20 + i, cy + j, `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`, a); }
    cy += 84;
  }
  px += 200;
}
fs.writeFileSync(path.join(outDir, 'preview.png'), encodePNG(1024, 720, prev.data));
console.log(`atlas ${W}x${H}, frames ${frames.length}, bytes ${fs.statSync(path.join(outDir, 'atlas.png')).size}`);
