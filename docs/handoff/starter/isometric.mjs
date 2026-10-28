/** Screen geometry only. A character position never changes task assignment or status. */
function finite(...values) {
  if (values.some(value => !Number.isFinite(value))) throw new TypeError('Coordinates must be finite');
}
export function projectIso(position, world) {
  const {x, y, z = 0} = position;
  const {tile_width: w, tile_height: h, elevation_px: e, origin: [ox, oy]} = world;
  finite(x, y, z, w, h, e, ox, oy);
  if (w <= 0 || h <= 0 || e <= 0) throw new RangeError('Invalid tile dimensions');
  return {x: ox + (x - y) * w / 2, y: oy + (x + y) * h / 2 - z * e};
}
export function unprojectIso(point, world, z = 0) {
  const {tile_width: w, tile_height: h, elevation_px: e, origin: [ox, oy]} = world;
  finite(point.x, point.y, w, h, e, ox, oy, z);
  if (w <= 0 || h <= 0 || e <= 0) throw new RangeError('Invalid tile dimensions');
  const u = (point.x - ox) / (w / 2);
  const v = (point.y - oy + z * e) / (h / 2);
  return {x: (u + v) / 2, y: (v - u) / 2, z};
}
/** camera.pan values and rect are CSS pixels; scale is CSS pixels per logical pixel. */
export function sceneToClient(point, camera, rect) {
  finite(point.x, point.y, camera.scale, camera.panX, camera.panY, rect.left, rect.top);
  if (camera.scale <= 0) throw new RangeError('Invalid camera scale');
  return {x: rect.left + camera.panX + point.x * camera.scale, y: rect.top + camera.panY + point.y * camera.scale};
}
export function clientToScene(point, camera, rect) {
  finite(point.x, point.y, camera.scale, camera.panX, camera.panY, rect.left, rect.top);
  if (camera.scale <= 0) throw new RangeError('Invalid camera scale');
  return {x: (point.x - rect.left - camera.panX) / camera.scale, y: (point.y - rect.top - camera.panY) / camera.scale};
}
/** Ground-contact depth, not the top of the image or elevated head position. */
export function compareWorldObjects(a, b, world) {
  const ay = projectIso({...a.position, z: 0}, world).y;
  const by = projectIso({...b.position, z: 0}, world).y;
  const delta = ay - by || (a.sort_bias ?? 0) - (b.sort_bias ?? 0);
  if (delta) return delta;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
