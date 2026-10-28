/**
 * PixiJS 장면 생성. 바닥·벽(architecture) → 러그(floor_decor) → 가구·캐릭터(world, 접지점 정렬) → 조명 → 선택.
 * 장면 객체는 한 번 만들고, 업무 상태가 바뀌면 변경된 멤버의 시각 속성만 갱신한다. renderer 를 재생성하지 않는다.
 * 이 모듈은 DB 를 갱신하거나 명령을 보내지 않는다. 클릭은 콜백으로만 전달한다.
 */
import { Container, Graphics, Sprite, Texture, Polygon } from 'pixi.js';
import type { LoadedAtlas } from './assets';
import { SCENE, type SceneObject, type SceneSeat } from '../config/sceneTypes';
import { projectIso, footprintCenter, pointInPolygon } from './projectCoordinates';
import type { Clip } from '../../../domain/viewModel';

export interface SeatVisual {
  /** 연결된 멤버가 있는가. 없으면 캐릭터를 정적·반투명으로 두고 '미연결' */
  bound: boolean;
  avatarKey: string;          // 'avatar-gpt' 등 (자리의 외형. 멤버 ID 가 아님)
  clip: Clip;
  animate: boolean;
  dimmed: boolean;            // 다른 프로젝트 작업 중
  selected: boolean;
  hovered: boolean;
}

export interface HitTarget {
  kind: 'seat' | 'object';
  id: string;
  /** 장면(논리) 좌표의 기준점 */
  anchor: { x: number; y: number };
  contains(sx: number, sy: number): boolean;
}

interface SeatNode {
  seat: SceneSeat;
  container: Container;
  avatar: Sprite;
  fallback: Graphics;
  frames: Texture[];
  clip: Clip;
  frameIndex: number;
  acc: number;
  fps: number;
  animate: boolean;
  selectRing: Graphics;
  hoverRing: Graphics;
}

export interface OfficeScene {
  root: Container;
  hitTargets: HitTarget[];
  setSeatVisual(seatId: string, v: SeatVisual): void;
  /** ticker 에서 호출. deltaMs 는 renderer 시각이며 업무 상태와 무관하다. */
  tick(deltaMs: number): void;
  setMotionPaused(paused: boolean): void;
  seatAnchor(seatId: string): { x: number; y: number };
  objectAnchor(objectId: string): { x: number; y: number };
  missingAssets: string[];
  /** 진단용 읽기 전용 상태 */
  debugSeat(seatId: string): { clip: Clip; animate: boolean; frameIndex: number; frames: number; alpha: number; selected: boolean } | null;
  destroy(): void;
}

const pal = SCENE.theme.palette;
const hexNum = (h: string) => parseInt(h.slice(1), 16);

export function createOfficeScene(atlas: LoadedAtlas | null): OfficeScene {
  const world = SCENE.world;
  const root = new Container();
  root.eventMode = 'none';
  const architecture = new Container();
  const floorDecor = new Container();
  const worldLayer = new Container();
  worldLayer.sortableChildren = true;
  const lighting = new Container();
  const selection = new Container();
  root.addChild(architecture, floorDecor, worldLayer, lighting, selection);
  const missingAssets: string[] = [];
  const tex = (name: string): Texture | null => {
    const t = atlas?.texture(name) ?? null;
    if (!t && !missingAssets.includes(name)) missingAssets.push(name);
    return t;
  };

  // ---- 배경: 방 바깥 어두운 면 + 바닥 그림자
  const bg = new Graphics();
  const corners = [projectIso({ x: -0.5, y: -0.5 }, world), projectIso({ x: world.columns - 0.5, y: -0.5 }, world), projectIso({ x: world.columns - 0.5, y: world.rows - 0.5 }, world), projectIso({ x: -0.5, y: world.rows - 0.5 }, world)];
  bg.poly(corners.flatMap(p => [p.x, p.y])).fill({ color: hexNum(pal.floor_shadow) });
  // 바닥 두께 (남쪽·동쪽 단면)
  bg.poly([corners[3].x, corners[3].y, corners[2].x, corners[2].y, corners[2].x, corners[2].y + 10, corners[3].x, corners[3].y + 10]).fill({ color: 0x5b3f2f });
  bg.poly([corners[2].x, corners[2].y, corners[1].x, corners[1].y, corners[1].x, corners[1].y + 10, corners[2].x, corners[2].y + 10]).fill({ color: 0x4a3326 });
  architecture.addChild(bg);

  // ---- 바닥 타일
  const floorTex = [tex('floor-wood/0'), tex('floor-wood/1')];
  for (let y = 0; y < world.rows; y++) for (let x = 0; x < world.columns; x++) {
    const p = projectIso({ x, y }, world);
    const t = floorTex[(x * 7 + y * 3) % 5 === 0 ? 1 : 0];
    if (t) { const s = new Sprite(t); s.anchor.set(0.5, 0.5); s.position.set(p.x, p.y); architecture.addChild(s); }
    else { const g = new Graphics(); g.poly([p.x, p.y - 8, p.x + 16, p.y, p.x, p.y + 8, p.x - 16, p.y]).fill({ color: hexNum(pal.floor_light) }).stroke({ color: hexNum(pal.floor_shadow), width: 1 }); architecture.addChild(g); }
  }
  // ---- 벽 (북서 변: y=0 타일들, 북동 변: x=0 타일들) — 뒤쪽부터
  const nwWindows = new Set([3, 4, 9, 10, 15, 16, 21]);
  const neWindows = new Set([5, 6, 11, 12]);
  for (let y = world.rows - 1; y >= 0; y--) {
    const p = projectIso({ x: 0, y }, world);
    const t = tex(neWindows.has(y) ? 'wall-ne/window' : 'wall-ne/plain');
    if (t) { const s = new Sprite(t); s.anchor.set(0.5, 88 / 96); s.position.set(p.x, p.y); architecture.addChild(s); }
  }
  for (let x = 0; x < world.columns; x++) {
    const p = projectIso({ x, y: 0 }, world);
    const t = tex(nwWindows.has(x) ? 'wall-nw/window' : 'wall-nw/plain');
    if (t) { const s = new Sprite(t); s.anchor.set(0.5, 88 / 96); s.position.set(p.x, p.y); architecture.addChild(s); }
  }

  // ---- 소품·러그
  const hitTargets: HitTarget[] = [];
  const objectAnchors = new Map<string, { x: number; y: number }>();
  const placeSprite = (name: string, obj: SceneObject, layer: Container) => {
    const c = footprintCenter(obj.position, obj.footprint);
    const p = projectIso(c, world);
    objectAnchors.set(obj.id, p);
    const t = tex(name);
    let node: Container;
    if (t) { const s = new Sprite(t); node = s; }
    else {
      // 명시적 대체 도형 (에셋 실패)
      const g = new Graphics();
      const w = (obj.footprint[0] + obj.footprint[1]) * 16;
      g.rect(-w / 2, -40, w, 40).fill({ color: 0x8c8c8c, alpha: 0.6 }).stroke({ color: 0x333333, width: 1 });
      node = g;
    }
    node.position.set(p.x, p.y);
    node.zIndex = obj.layer === 'floor_decor' ? 0 : p.y * 10 + obj.sort_bias;
    layer.addChild(node);
    if (obj.action !== 'none') {
      const b = node.getLocalBounds();
      hitTargets.push({ kind: 'object', id: obj.id, anchor: p, contains: (sx, sy) => sx >= p.x + b.minX && sx <= p.x + b.maxX && sy >= p.y + b.minY && sy <= p.y + b.maxY });
    }
    return node;
  };
  for (const obj of SCENE.objects) {
    const variant = obj.variant ?? 0;
    const name = `${obj.asset_id}/${variant}`;
    placeSprite(atlas?.texture(name) ? name : `${obj.asset_id}/0`, obj, obj.layer === 'floor_decor' ? floorDecor : worldLayer);
  }

  // ---- 자리 (책상 rear/chair/avatar/front + 선택 링)
  const seats = new Map<string, SeatNode>();
  const avatarOffset = atlas?.meta.desk_avatar_offset ?? { x: -7, y: -4 };
  for (const seat of SCENE.seats) {
    const c = footprintCenter(seat.position, seat.footprint);
    const p = projectIso(c, world);
    const container = new Container();
    container.position.set(p.x, p.y);
    container.zIndex = p.y * 10;
    const part = (name: string) => {
      const t = tex(`${seat.asset_id}/${name}`);
      if (!t) return null;
      const s = new Sprite(t); s.position.set(0, 0); return s;
    };
    const rear = part('rear'), chair = part('chair'), front = part('front');
    const hoverRing = new Graphics();
    const selectRing = new Graphics();
    const ring = (g: Graphics, color: number, alpha: number) => {
      const pts = [[-0.5, -0.5], [seat.footprint[0] - 0.5, -0.5], [seat.footprint[0] - 0.5, seat.footprint[1] - 0.5], [-0.5, seat.footprint[1] - 0.5]]
        .map(([dx, dy]) => projectIso({ x: seat.position.x + dx, y: seat.position.y + dy }, world))
        .map(q => [q.x - p.x, q.y - p.y]);
      g.poly(pts.flat()).fill({ color, alpha: alpha * 0.25 }).stroke({ color, width: 2, alpha });
      g.visible = false;
    };
    ring(hoverRing, 0xfff3d6, 0.8);
    ring(selectRing, hexNum(pal.attention), 1);
    container.addChild(hoverRing, selectRing);
    if (rear) container.addChild(rear);
    if (chair) container.addChild(chair);
    const avatar = new Sprite(Texture.EMPTY);
    avatar.anchor.set(0.5, 0.9);
    avatar.position.set(avatarOffset.x, avatarOffset.y);
    const fallback = new Graphics();
    fallback.rect(-10, -44, 20, 40).fill({ color: 0x9a9a9a, alpha: 0.8 }).stroke({ color: 0x333333, width: 1 });
    fallback.position.set(avatarOffset.x, avatarOffset.y);
    fallback.visible = false;
    container.addChild(avatar, fallback);
    if (front) container.addChild(front);
    if (!rear && !front) {
      const g = new Graphics(); g.rect(-40, -30, 80, 30).fill({ color: 0x8c8c8c, alpha: 0.6 }).stroke({ color: 0x333333, width: 1 }); container.addChildAt(g, 2);
    }
    worldLayer.addChild(container);
    const poly = new Polygon(seat.hit_polygon.flat());
    hitTargets.push({ kind: 'seat', id: seat.id, anchor: p, contains: (sx, sy) => poly.contains(sx - p.x, sy - p.y) || pointInPolygon(sx - p.x, sy - p.y, seat.hit_polygon) });
    seats.set(seat.id, { seat, container, avatar, fallback, frames: [], clip: 'still', frameIndex: 0, acc: 0, fps: 0, animate: false, selectRing, hoverRing });
  }

  // ---- 조명: 정적인 앰버 광량 (움직임 없음)
  const light = new Graphics();
  const pool = (x: number, y: number, r: number, a: number) => {
    for (let i = 3; i >= 1; i--) light.ellipse(x, y, r * i / 3, r * i / 6).fill({ color: hexNum(pal.lamp), alpha: a / i });
  };
  const ownerLamp = objectAnchors.get('owner-desk'); if (ownerLamp) pool(ownerLamp.x - 10, ownerLamp.y + 6, 70, 0.10);
  const floorLamp = objectAnchors.get('floor-lamp'); if (floorLamp) pool(floorLamp.x, floorLamp.y + 4, 60, 0.12);
  const coffee = objectAnchors.get('coffee-station'); if (coffee) pool(coffee.x, coffee.y + 8, 40, 0.08);
  // 창문 빛 (북서 벽 창 아래)
  for (const x of [3.5, 9.5, 15.5]) { const q = projectIso({ x, y: 1.2 }, world); light.ellipse(q.x, q.y, 48, 18).fill({ color: 0xffffff, alpha: 0.07 }); }
  lighting.addChild(light);

  let paused = false;
  const setFrames = (node: SeatNode, key: string, clip: Clip) => {
    const frames = atlas?.frames(`${key}/${clip}`) ?? [];
    node.frames = frames;
    node.clip = clip;
    node.frameIndex = 0;
    node.acc = 0;
    node.fps = atlas?.meta.clips[clip]?.fps ?? 0;
    if (frames.length) { node.avatar.texture = frames[0]; node.avatar.visible = true; node.fallback.visible = false; }
    else { node.avatar.visible = false; node.fallback.visible = true; if (!missingAssets.includes(`${key}/${clip}`)) missingAssets.push(`${key}/${clip}`); }
  };
  const currentKey = new Map<string, string>();

  return {
    root, hitTargets, missingAssets,
    setSeatVisual(seatId, v) {
      const node = seats.get(seatId); if (!node) return;
      const key = v.avatarKey;
      if (currentKey.get(seatId) !== key || node.clip !== v.clip) { currentKey.set(seatId, key); setFrames(node, key, v.clip); }
      node.animate = v.animate && v.clip !== 'still';
      if (!node.animate && node.frames.length) { node.frameIndex = 0; node.avatar.texture = node.frames[0]; }
      node.avatar.alpha = v.bound ? (v.dimmed ? 0.7 : 1) : 0.45;
      node.fallback.alpha = v.bound ? 1 : 0.45;
      node.selectRing.visible = v.selected;
      node.hoverRing.visible = v.hovered && !v.selected;
    },
    tick(deltaMs) {
      if (paused) return;
      for (const node of seats.values()) {
        if (!node.animate || node.frames.length < 2 || node.fps <= 0) continue;
        node.acc += deltaMs;
        const step = 1000 / node.fps;
        if (node.acc >= step) {
          const n = Math.floor(node.acc / step);
          node.acc -= n * step;
          node.frameIndex = (node.frameIndex + n) % node.frames.length;
          node.avatar.texture = node.frames[node.frameIndex];
        }
      }
    },
    setMotionPaused(p) { paused = p; },
    debugSeat(seatId) { const n = seats.get(seatId); return n ? { clip: n.clip, animate: n.animate, frameIndex: n.frameIndex, frames: n.frames.length, alpha: n.avatar.alpha, selected: n.selectRing.visible } : null; },
    seatAnchor(seatId) { const n = seats.get(seatId); return n ? { x: n.container.x, y: n.container.y } : { x: 0, y: 0 }; },
    objectAnchor(objectId) { return objectAnchors.get(objectId) ?? { x: 0, y: 0 }; },
    destroy() { root.destroy({ children: true }); seats.clear(); },
  };
}
