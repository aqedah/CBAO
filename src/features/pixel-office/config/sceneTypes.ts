import sceneJson from './office.scene.json';
import visualJson from './office.visual-states.json';

export type SceneAction =
  | 'none' | 'open_records' | 'open_tasks' | 'open_handoffs' | 'open_approvals'
  | 'open_connections' | 'open_ambience_settings';

export interface SceneSeat {
  id: string;
  member_binding: { seed_key: string; member_id: string | null; auto_create_member: boolean };
  label: string;
  suggested_role: string;
  suggested_mode: string;
  zone_id: string;
  position: { x: number; y: number; z: number };
  footprint: number[];
  asset_id: string;
  avatar_asset_id: string;
  orientation: string;
  label_offset: number[];
  hit_polygon: number[][];
  accent: string;
  desk_prop: string;
  binding_required_for_live_status: boolean;
}

export interface SceneObject {
  id: string;
  asset_id: string;
  position: { x: number; y: number; z: number };
  zone_id: string;
  footprint: number[];
  layer: 'world' | 'floor_decor';
  sort_bias: number;
  action: SceneAction;
  label: string;
  variant?: number;
}

export interface SceneConfig {
  schema_version: string;
  world: { columns: number; rows: number; tile_width: number; tile_height: number; elevation_px: number; origin: number[] };
  renderer: { logical_size: number[] };
  camera: { zoom_steps: number[]; initial_zoom: number };
  theme: { palette: Record<string, string> };
  seats: SceneSeat[];
  objects: SceneObject[];
  motion: { idle_fps: number; work_fps: number; renderer_fps_cap: number };
  data: { heartbeat_delay_seconds: number; heartbeat_offline_seconds: number };
}

export const SCENE = sceneJson as unknown as SceneConfig;
export const VISUAL_STATES = visualJson as { states: Record<string, { label: string; clip: string; color_token: string; icon: string; work_motion: boolean }> };
