// 가구·건축 에셋. 모든 에셋은 같은 등각 그리드(32×16)·광원(좌측 상단)·픽셀 밀도를 쓴다.
// 문자·숫자·로고·진행률·상태등은 그리지 않는다. (상태는 DOM 과 실제 데이터로 표시)
import { Canvas, isoBox, isoDiamond, iso, shade } from './canvas.mjs';
import { P } from './palette.mjs';

const OAK = { top: P.oakTop, left: P.oakLeft, right: P.oakRight, line: P.line };
const groundShadow = (c, ax, ay, fw, fh) => isoDiamond(c, ax + 2, ay + 1, fw, fh, P.shadow, 60);

export function floorTile(variant) {
  const c = new Canvas(32, 16);
  const base = variant === 1 ? P.floorDark : P.floorLight;
  isoDiamond(c, 16, 8, 1, 1, base);
  // 널빤지 결: 타일 대각선 방향 선 2개
  const grain = shade(base, 0.9);
  for (const k of [-4, 4]) {
    const [x0, y0] = iso(-0.5 + 0, -0.5), [x1, y1] = iso(0.5, 0.5);
    c.line(16 + x0 + k, 8 + y0, 16 + x1 + k, 8 + y1, grain);
  }
  // 타일 경계(아래쪽 두 변)
  const [sx, sy] = iso(0.5, 0.5), [wx, wy] = iso(-0.5, 0.5), [ex, ey] = iso(0.5, -0.5);
  c.line(16 + wx, 8 + wy, 16 + sx, 8 + sy - 1, P.floorLine);
  c.line(16 + sx, 8 + sy - 1, 16 + ex, 8 + ey, P.floorLine);
  return c;
}

/** 벽 패널 한 타일분. side: 'nw'(타일 북쪽 변) | 'ne'(타일 서쪽 변). kind: 'plain' | 'window' */
export function wallPanel(side, kind) {
  const c = new Canvas(32, 96);
  const ax = 16, ay = 88; // 타일 중심
  const H = 72;
  let a, b;
  if (side === 'nw') { a = iso(-0.5, -0.5); b = iso(0.5, -0.5); }
  else { a = iso(0.5, -0.5); b = iso(-0.5, -0.5); } // ne: 동쪽 변 대신 북쪽 변 왼쪽→ 사용 안함
  if (side === 'ne') { a = iso(-0.5, -0.5); b = iso(-0.5, 0.5); }
  const p = (v, h) => [ax + v[0], ay + v[1] - h];
  const face = side === 'nw' ? P.wall : P.wallShade;
  c.poly([p(a, H), p(b, H), p(b, 0), p(a, 0)], face);
  // 걸레받이
  c.poly([p(a, 6), p(b, 6), p(b, 0), p(a, 0)], P.wallTrim);
  c.line(...p(a, 6), ...p(b, 6), P.lineSoft);
  // 상단 몰딩
  c.line(...p(a, H), ...p(b, H), P.lineSoft);
  if (kind === 'window') {
    const w = (t, h) => p([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], h);
    c.poly([w(0.12, 60), w(0.88, 60), w(0.88, 22), w(0.12, 22)], P.windowFrame);
    c.poly([w(0.2, 56), w(0.8, 56), w(0.8, 26), w(0.2, 26)], P.window);
    c.poly([w(0.2, 56), w(0.5, 56), w(0.5, 40), w(0.2, 40)], P.windowLight);
    c.line(...w(0.5, 56), ...w(0.5, 26), P.windowFrame);
    c.line(...w(0.2, 41), ...w(0.8, 41), P.windowFrame);
  }
  return c;
}

export function wallCorner() {
  const c = new Canvas(32, 96);
  c.vline(16, 16, 88, P.lineSoft);
  c.vline(15, 16, 88, P.wallTrim);
  return c;
}

/** 기본 책상: rear / chair / front 세 부분. 128×128, anchor (64,112) = footprint(3×2) 중심 접지점 */
export function deskParts() {
  const mk = () => new Canvas(128, 128);
  const ax = 64, ay = 112;
  // --- rear: 뒤쪽 낮은 수납장 (캐릭터 뒤)
  const rear = mk();
  {
    const [ox, oy] = iso(-1.0, -0.9);
    isoBox(rear, ax + ox, ay + oy, 0.9, 0.6, 18, OAK);
    const [hx, hy] = iso(-1.0, -0.9);
    rear.rect(ax + hx - 4, ay + hy - 10, 3, 1, P.metal);
    rear.rect(ax + hx - 4, ay + hy - 5, 3, 1, P.metal);
  }
  // --- chair: 캐릭터 자리 (-0.45,-0.45)
  const chair = mk();
  {
    const [cx, cy] = iso(-0.45, -0.45);
    const x = ax + cx, y = ay + cy;
    groundShadow(chair, x, y, 0.8, 0.8);
    // 바퀴/기둥
    chair.rect(x - 6, y - 1, 12, 2, P.metalDark);
    chair.rect(x - 1, y - 12, 2, 12, P.metal);
    // 좌판
    isoBox(chair, x, y - 12, 0.8, 0.8, 5, { top: P.sageLight, left: P.sage, right: P.sageDark, line: P.line });
    // 등받이 (뒤쪽, 북서 방향)
    const [bx, by] = iso(-0.3, -0.3);
    const BK = [[x + bx - 15, y + by - 14], [x + bx + 15, y + by - 14], [x + bx + 15, y + by - 46], [x + bx - 15, y + by - 46]];
    chair.poly(BK, P.sage); chair.outline(BK, P.line);
    chair.poly([[x + bx - 12, y + by - 17], [x + bx + 12, y + by - 17], [x + bx + 12, y + by - 43], [x + bx - 12, y + by - 43]], P.sageLight);
    chair.rect(x + bx - 1, y + by - 14, 2, 3, P.metalDark);
  }
  // --- front: 책상 본체 + 모니터 + 키보드 + 머그 + 노트
  const front = mk();
  {
    const [dx, dy] = iso(0.3, 0.3);
    const x = ax + dx, y = ay + dy;
    groundShadow(front, x, y, 3, 1.3);
    // 다리
    for (const [lx, ly] of [iso(-1.3, 0.5), iso(1.3, 0.5), iso(1.3, -0.5)]) front.rect(x + lx - 1, y + ly - 18, 3, 18, P.oakDark);
    const box = isoBox(front, x, y, 3, 1.3, 20, OAK);
    void box;
    // 모니터 (오른쪽 뒤편)
    const [mx, my] = iso(0.75, -0.25);
    const sx = x + mx, sy = y + my - 20;
    front.rect(sx - 3, sy - 3, 6, 2, P.metalDark);
    front.rect(sx - 1, sy - 9, 2, 7, P.metalDark);
    front.poly([[sx - 9, sy - 9], [sx + 9, sy - 18], [sx + 9, sy - 31], [sx - 9, sy - 22]], P.monitor);
    front.poly([[sx - 7, sy - 11], [sx + 7, sy - 18], [sx + 7, sy - 29], [sx - 7, sy - 22]], P.monitorScreen);
    front.poly([[sx - 7, sy - 11], [sx - 1, sy - 14], [sx - 1, sy - 25], [sx - 7, sy - 22]], P.monitorScreenLight);
    // 키보드 (중앙 앞)
    const [kx, ky] = iso(0.0, 0.2);
    isoBox(front, x + kx, y + ky - 20, 0.8, 0.35, 2, { top: P.cream, left: P.creamShade, right: P.creamShade, line: P.lineSoft });
    // 머그 (왼쪽)
    const [gx, gy] = iso(-0.95, -0.2);
    front.rect(x + gx - 3, y + gy - 28, 6, 7, P.mug);
    front.rect(x + gx - 3, y + gy - 28, 2, 7, P.mugDark);
    front.rect(x + gx + 3, y + gy - 26, 2, 3, P.mugDark);
    front.outline([[x + gx - 3, y + gy - 28], [x + gx + 2, y + gy - 28], [x + gx + 2, y + gy - 22], [x + gx - 3, y + gy - 22]], P.lineSoft);
    // 노트 (왼쪽 앞)
    const [nx, ny] = iso(-0.75, 0.3);
    isoBox(front, x + nx, y + ny - 20, 0.5, 0.4, 1, { top: P.paper, left: P.creamShade, right: P.creamShade, line: P.lineSoft });
  }
  return { rear, chair, front, avatarOffset: iso(-0.45, -0.45) };
}

export function bookshelf() {
  const c = new Canvas(96, 128);
  const ax = 48, ay = 112;
  groundShadow(c, ax, ay, 2, 1);
  isoBox(c, ax, ay, 2, 0.9, 84, OAK);
  // 선반 3단 (왼쪽 면에 보이는 책들)
  const colors = [P.terracotta, P.sage, P.blue, P.amber, P.slate, P.cream, P.rugDark];
  for (let s = 0; s < 3; s++) {
    const h = 16 + s * 24;
    const [wx, wy] = iso(-1, 0.45), [sx, sy] = iso(1, 0.45);
    c.line(ax + wx, ay + wy - h, ax + sx, ay + sy - h, P.oakDark);
    c.line(ax + wx, ay + wy - h + 1, ax + sx, ay + sy - h + 1, P.oakDark);
    let bx = ax + wx + 3;
    let i = s * 3;
    while (bx < ax + sx - 4) {
      const w = 3 + (i % 3), bh = 10 + (i % 4) * 2;
      const t = (bx - (ax + wx)) / (sx - wx);
      const by = ay + wy - h + (sy - wy) * t;
      c.rect(bx, by - bh - 1, w, bh, colors[i % colors.length]);
      c.vline(bx, by - bh - 1, by - 2, shade(colors[i % colors.length], 0.75));
      bx += w + 1; i++;
    }
  }
  return c;
}

export function taskBoard() {
  const c = new Canvas(96, 128);
  const ax = 48, ay = 112;
  groundShadow(c, ax, ay, 1, 1);
  // 스탠드
  const [lx, ly] = iso(-0.3, 0), [rx, ry] = iso(0.3, 0);
  c.rect(ax + lx - 1, ay + ly - 28, 3, 28, P.oakDark);
  c.rect(ax + rx - 1, ay + ry - 28, 3, 28, P.oakDark);
  // 보드 (북동 방향 벽면과 평행: ne 벽은 iso(-0.5,-0.5)→iso(-0.5,0.5) 방향)
  const a = iso(-0.45, -0.6), b = iso(-0.45, 0.6);
  const p = (v, h) => [ax + v[0] + 8, ay + v[1] - h];
  c.poly([p(a, 24), p(b, 24), p(b, 84), p(a, 84)], P.boardFrame);
  c.poly([p(a, 28), p(b, 28), p(b, 80), p(a, 80)], P.board);
  c.outline([p(a, 24), p(b, 24), p(b, 84), p(a, 84)], P.line);
  // 빈 메모지 (문자 없음)
  const sticky = [[0.2, 66, P.stickyY], [0.55, 62, P.stickyG], [0.3, 46, P.stickyP], [0.7, 42, P.stickyY]];
  for (const [t, h, col] of sticky) {
    const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const [qx, qy] = p(q, h);
    c.poly([[qx, qy], [qx + 7, qy + 3.5], [qx + 7, qy + 11], [qx, qy + 7.5]], col);
  }
  return c;
}

export function meetingTable() {
  const c = new Canvas(192, 128);
  const ax = 96, ay = 112;
  groundShadow(c, ax, ay, 4.2, 1.6);
  // 의자 4개 (테이블 북쪽 2, 남쪽 2) — 사람 없음
  const stool = (dx, dy) => {
    const [sx, sy] = iso(dx, dy);
    c.rect(ax + sx - 1, ay + sy - 8, 2, 8, P.metalDark);
    isoBox(c, ax + sx, ay + sy - 8, 0.55, 0.55, 4, { top: P.terracotta, left: P.terracottaDark, right: shade(P.terracottaDark, 0.85), line: P.line });
  };
  stool(-1.2, -1.1); stool(0.8, -1.1);
  for (const [lx, ly] of [iso(-1.9, 0.6), iso(1.9, 0.6), iso(1.9, -0.6)]) c.rect(ax + lx - 1, ay + ly - 20, 3, 20, P.oakDark);
  isoBox(c, ax, ay, 4.2, 1.5, 22, OAK);
  stool(-1.2, 1.2); stool(0.8, 1.2);
  // 테이블 위 종이 몇 장 (문자 없음)
  for (const [dx, dy] of [[-1.1, -0.2], [0.2, 0.1], [1.2, -0.3]]) {
    const [px, py] = iso(dx, dy);
    isoBox(c, ax + px, ay + py - 22, 0.5, 0.4, 1, { top: P.paper, left: P.creamShade, right: P.creamShade, line: P.lineSoft });
  }
  return c;
}

export function ownerDesk() {
  const c = new Canvas(144, 128);
  const ax = 72, ay = 112;
  groundShadow(c, ax, ay, 3.2, 1.8);
  // 의자 (비어 있음, 북서쪽)
  {
    const [cx, cy] = iso(-0.3, -0.7);
    const x = ax + cx, y = ay + cy;
    c.rect(x - 1, y - 10, 2, 10, P.metal);
    isoBox(c, x, y - 10, 0.8, 0.8, 5, { top: P.terracotta, left: P.terracottaDark, right: shade(P.terracottaDark, 0.85), line: P.line });
    c.poly([[x - 10, y - 15], [x + 4, y - 22], [x + 4, y - 46], [x - 10, y - 39]], P.terracottaDark);
    c.outline([[x - 10, y - 15], [x + 4, y - 22], [x + 4, y - 46], [x - 10, y - 39]], P.line);
  }
  const [dx, dy] = iso(0.3, 0.4);
  const x = ax + dx, y = ay + dy;
  for (const [lx, ly] of [iso(-1.4, 0.6), iso(1.4, 0.6), iso(1.4, -0.6)]) c.rect(x + lx - 1, y + ly - 26, 3, 26, P.oakDark);
  isoBox(c, x, y, 3.2, 1.4, 26, { top: shade(P.oakTop, 0.92), left: P.oakLeft, right: P.oakRight, line: P.line });
  // 스탠드 조명 (왼쪽 뒤)
  const [lx, ly] = iso(-1.0, -0.4);
  c.rect(x + lx - 1, y + ly - 48, 2, 22, P.metalDark);
  c.poly([[x + lx - 8, y + ly - 48], [x + lx + 8, y + ly - 48], [x + lx + 5, y + ly - 56], [x + lx - 5, y + ly - 56]], P.amber);
  c.outline([[x + lx - 8, y + ly - 48], [x + lx + 8, y + ly - 48], [x + lx + 5, y + ly - 56], [x + lx - 5, y + ly - 56]], P.line);
  // 서류 더미 + 결재함 (빈 상자)
  const [px, py] = iso(0.1, 0.1);
  isoBox(c, x + px, y + py - 26, 0.7, 0.5, 4, { top: P.paper, left: P.creamShade, right: P.creamShade, line: P.lineSoft });
  const [tx, ty] = iso(1.0, -0.3);
  isoBox(c, x + tx, y + ty - 26, 0.6, 0.5, 6, { top: P.cream, left: P.oakLeft, right: P.oakRight, line: P.lineSoft });
  // 머그
  const [gx, gy] = iso(-0.2, 0.5);
  c.rect(x + gx - 3, y + gy - 33, 6, 7, P.mug); c.rect(x + gx - 3, y + gy - 33, 2, 7, P.mugDark);
  return c;
}

export function sofa() {
  const c = new Canvas(160, 112);
  const ax = 80, ay = 96;
  groundShadow(c, ax, ay, 3, 1.6);
  const S = { top: P.sageLight, left: P.sage, right: P.sageDark, line: P.line };
  // 프레임(오크) 아래
  isoBox(c, ax, ay, 3, 1.5, 8, OAK);
  // 좌석 쿠션 2개
  const [c1x, c1y] = iso(-0.7, 0.1), [c2x, c2y] = iso(0.7, 0.1);
  isoBox(c, ax + c1x, ay + c1y, 1.3, 1.1, 8, S, { z: 8 });
  isoBox(c, ax + c2x, ay + c2y, 1.3, 1.1, 8, S, { z: 8 });
  // 등받이 (북쪽 긴 변)
  const [bx, by] = iso(0, -0.55);
  isoBox(c, ax + bx, ay + by, 3, 0.4, 22, S, { z: 8 });
  // 팔걸이
  const [ax1, ay1] = iso(-1.35, 0.15), [ax2, ay2] = iso(1.35, 0.15);
  isoBox(c, ax + ax1, ay + ay1, 0.3, 1.5, 14, S, { z: 8 });
  isoBox(c, ax + ax2, ay + ay2, 0.3, 1.5, 14, S, { z: 8 });
  // 쿠션 하나 (앰버)
  const [px, py] = iso(0.7, -0.25);
  isoBox(c, ax + px, ay + py, 0.55, 0.45, 6, { top: P.amber, left: P.amberDark, right: shade(P.amberDark, 0.85), line: P.line }, { z: 16 });
  return c;
}

export function coffeeStation() {
  const c = new Canvas(80, 112);
  const ax = 40, ay = 96;
  groundShadow(c, ax, ay, 1, 2);
  isoBox(c, ax, ay, 1, 1.9, 30, OAK);
  // 커피 머신 (뒤쪽)
  const [mx, my] = iso(0, -0.5);
  isoBox(c, ax + mx, ay + my - 30, 0.6, 0.6, 16, { top: P.metal, left: P.metalDark, right: shade(P.metalDark, 0.8), line: P.line });
  // 머그 2개 (앞쪽)
  for (const [dx, dy] of [[-0.1, 0.35], [0.25, 0.65]]) {
    const [gx, gy] = iso(dx, dy);
    c.rect(ax + gx - 3, ay + gy - 37, 6, 6, P.mug); c.rect(ax + gx - 3, ay + gy - 37, 2, 6, P.mugDark);
    c.outline([[ax + gx - 3, ay + gy - 37], [ax + gx + 2, ay + gy - 37], [ax + gx + 2, ay + gy - 32], [ax + gx - 3, ay + gy - 32]], P.lineSoft);
  }
  return c;
}

export function plant(variant) {
  const c = new Canvas(64, 96);
  const ax = 32, ay = 84;
  groundShadow(c, ax, ay, 0.8, 0.8);
  // 화분 (테라코타)
  isoBox(c, ax, ay, 0.7, 0.7, 14, { top: P.terracotta, left: P.terracottaDark, right: shade(P.terracottaDark, 0.85), line: P.line });
  c.rect(ax - 9, ay - 18, 18, 3, P.terracotta);
  c.hline(ax - 9, ax + 8, ay - 18, P.line);
  // 흙
  isoDiamond(c, ax, ay - 14, 0.55, 0.55, P.oakDark);
  // 잎 덩어리 (채도 낮은 세이지)
  const leaves = variant === 1
    ? [[0, -34, 11, 9], [-8, -28, 8, 7], [8, -27, 8, 7], [-3, -44, 8, 7], [5, -42, 7, 6]]
    : [[0, -30, 12, 9], [-9, -24, 8, 6], [9, -23, 8, 6], [0, -40, 9, 7]];
  for (const [dx, dy, rx, ry] of leaves) c.ellipse(ax + dx, ay + dy, rx, ry, P.sage);
  for (const [dx, dy, rx, ry] of leaves) c.ellipse(ax + dx - 2, ay + dy - 2, rx * 0.55, ry * 0.5, P.sageLight);
  for (const [dx, dy, rx, ry] of leaves) { const e = new Canvas(1, 1); void e; c.ellipse(ax + dx + 3, ay + dy + 3, rx * 0.4, ry * 0.4, P.sageDark, 120); }
  // 줄기
  c.vline(ax, ay - 30, ay - 15, P.sageDark);
  return c;
}

export function rug() {
  const c = new Canvas(192, 96);
  const ax = 96, ay = 84;
  isoDiamond(c, ax, ay, 5, 3, P.rug);
  isoDiamond(c, ax, ay, 4.4, 2.5, P.rugLight);
  isoDiamond(c, ax, ay, 3.6, 1.9, P.rug);
  isoDiamond(c, ax, ay, 1.2, 0.8, P.rugDark);
  // 외곽선
  const P4 = [iso(-2.5, -1.5), iso(2.5, -1.5), iso(2.5, 1.5), iso(-2.5, 1.5)].map(([x, y]) => [ax + x, ay + y]);
  c.outline(P4, P.rugDark);
  return c;
}

export function runnerConsole() {
  const c = new Canvas(64, 96);
  const ax = 32, ay = 84;
  groundShadow(c, ax, ay, 0.8, 0.8);
  // 작은 받침대 + PC 본체. 상태등 없음(연결 상태는 실제 데이터로 DOM 에 표시)
  isoBox(c, ax, ay, 0.8, 0.8, 10, OAK);
  isoBox(c, ax, ay - 10, 0.55, 0.55, 30, { top: P.metal, left: P.metalDark, right: shade(P.metalDark, 0.8), line: P.line });
  const [fx, fy] = iso(-0.27, 0.27);
  c.rect(ax + fx + 2, ay + fy - 34, 6, 1, P.slate);
  c.rect(ax + fx + 2, ay + fy - 30, 6, 1, P.slate);
  return c;
}

export function floorLamp() {
  const c = new Canvas(48, 112);
  const ax = 24, ay = 100;
  groundShadow(c, ax, ay, 0.5, 0.5);
  isoDiamond(c, ax, ay, 0.5, 0.5, P.metalDark);
  c.rect(ax - 1, ay - 70, 2, 70, P.metalDark);
  c.poly([[ax - 12, ay - 70], [ax + 12, ay - 70], [ax + 8, ay - 88], [ax - 8, ay - 88]], P.amber);
  c.outline([[ax - 12, ay - 70], [ax + 12, ay - 70], [ax + 8, ay - 88], [ax - 8, ay - 88]], P.line);
  c.poly([[ax - 10, ay - 71], [ax + 10, ay - 71], [ax + 7, ay - 80], [ax - 7, ay - 80]], shade(P.amber, 1.08));
  return c;
}
