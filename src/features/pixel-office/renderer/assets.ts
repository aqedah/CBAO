/**
 * 아틀라스 로딩. 소유권: 픽셀 사무실 라우트가 처음 열릴 때 1회 로드하고 모듈 캐시에 둔다.
 * 다른 화면이 쓰지 않으므로 라우트 이탈 시 텍스처를 파괴하지 않고(재진입 비용 절감), 앱 종료까지 유지한다.
 * 로딩 실패는 호출자에게 throw 되어 자리별 대체 도형과 안내로 처리한다.
 */
import { Assets, Spritesheet, Texture, type SpritesheetData } from 'pixi.js';

export interface AtlasMeta {
  desk_avatar_offset: { x: number; y: number };
  clips: Record<string, { frames: number; fps: number }>;
  license: string;
}

export interface LoadedAtlas {
  sheet: Spritesheet;
  meta: AtlasMeta;
  texture(name: string): Texture | null;
  frames(animation: string): Texture[];
}

let cache: Promise<LoadedAtlas> | null = null;

export function atlasUrl(): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
  return `${base}pixel-office/atlas.json`;
}

export function loadAtlas(): Promise<LoadedAtlas> {
  if (!cache) {
    cache = (async () => {
      const url = atlasUrl();
      const res = await fetch(url);
      if (!res.ok) throw new Error(`아틀라스 JSON 로딩 실패 (${res.status})`);
      const data = (await res.json()) as SpritesheetData & { meta: AtlasMeta & { image: string } };
      const imageUrl = url.replace(/atlas\.json$/, data.meta.image);
      const texture = await Assets.load<Texture>({ src: imageUrl, data: { scaleMode: 'nearest' } });
      texture.source.scaleMode = 'nearest';
      texture.source.autoGenerateMipmaps = false;
      const sheet = new Spritesheet(texture, data);
      await sheet.parse();
      return {
        sheet,
        meta: data.meta,
        texture: (name: string) => sheet.textures[name] ?? null,
        frames: (anim: string) => sheet.animations[anim] ?? [],
      };
    })().catch(e => { cache = null; throw e; });
  }
  return cache;
}

/** 테스트/진단용: 캐시를 비운다 (텍스처는 GPU 에서 해제). */
export function resetAtlasCache() {
  cache?.then(a => a.sheet.destroy(true)).catch(() => undefined);
  cache = null;
}
