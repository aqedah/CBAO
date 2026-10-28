/** 화면 기하만 다룬다. 캐릭터 위치는 업무 배정·상태를 바꾸지 않는다. (starter/isometric.mjs 이식) */
export interface World { tile_width: number; tile_height: number; elevation_px: number; origin: [number, number] | number[] }
export interface Pos { x: number; y: number; z?: number }
export interface Camera { scale: number; panX: number; panY: number }
export interface RectLike { left: number; top: number }

function finite(...values: number[]) {
  if (values.some(v => !Number.isFinite(v))) throw new TypeError('Coordinates must be finite');
}

export function projectIso(position: Pos, world: World): { x: number; y: number } {
  const { x, y, z = 0 } = position;
  const w = world.tile_width, h = world.tile_height, e = world.elevation_px, [ox, oy] = world.origin;
  finite(x, y, z, w, h, e, ox, oy);
  if (w <= 0 || h <= 0 || e <= 0) throw new RangeError('Invalid tile dimensions');
  return { x: ox + (x - y) * w / 2, y: oy + (x + y) * h / 2 - z * e };
}

export function unprojectIso(point: { x: number; y: number }, world: World, z = 0): Pos {
  const w = world.tile_width, h = world.tile_height, e = world.elevation_px, [ox, oy] = world.origin;
  finite(point.x, point.y, w, h, e, ox, oy, z);
  if (w <= 0 || h <= 0 || e <= 0) throw new RangeError('Invalid tile dimensions');
  const u = (point.x - ox) / (w / 2);
  const v = (point.y - oy + z * e) / (h / 2);
  return { x: (u + v) / 2, y: (v - u) / 2, z };
}

/** camera.pan 과 rect 는 CSS px, scale 은 논리 px 당 CSS px. 포인터와 DOM 라벨이 같은 변환을 쓴다. */
export function sceneToClient(point: { x: number; y: number }, camera: Camera, rect: RectLike) {
  finite(point.x, point.y, camera.scale, camera.panX, camera.panY, rect.left, rect.top);
  if (camera.scale <= 0) throw new RangeError('Invalid camera scale');
  return { x: rect.left + camera.panX + point.x * camera.scale, y: rect.top + camera.panY + point.y * camera.scale };
}

export function clientToScene(point: { x: number; y: number }, camera: Camera, rect: RectLike) {
  finite(point.x, point.y, camera.scale, camera.panX, camera.panY, rect.left, rect.top);
  if (camera.scale <= 0) throw new RangeError('Invalid camera scale');
  return { x: (point.x - rect.left - camera.panX) / camera.scale, y: (point.y - rect.top - camera.panY) / camera.scale };
}

/** 접지점 깊이 정렬. 이미지 윗부분이나 머리 높이로 정렬하지 않는다. */
export function compareWorldObjects(
  a: { id: string; position: Pos; sort_bias?: number }, b: { id: string; position: Pos; sort_bias?: number }, world: World,
): number {
  const ay = projectIso({ ...a.position, z: 0 }, world).y;
  const by = projectIso({ ...b.position, z: 0 }, world).y;
  const delta = ay - by || (a.sort_bias ?? 0) - (b.sort_bias ?? 0);
  if (delta) return delta;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** footprint 중심(접지 기준점). 장면 JSON 의 position 은 footprint 의 좌상단 타일이다. */
export function footprintCenter(position: Pos, footprint: [number, number] | number[]): Pos {
  return { x: position.x + footprint[0] / 2 - 0.5, y: position.y + footprint[1] / 2 - 0.5, z: position.z ?? 0 };
}

export function pointInPolygon(px: number, py: number, poly: Array<[number, number] | number[]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
