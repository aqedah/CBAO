/** 해시 라우팅 (GitHub Pages 정적 배포 전제). */
import { useSyncExternalStore } from 'react';

export interface Route {
  path: string;            // '#' 없이, 쿼리 제외. 예: '/office/room'
  query: URLSearchParams;
  hash: string;            // 원본
}

function parse(): Route {
  const raw = typeof location !== 'undefined' ? location.hash : '';
  const body = raw.startsWith('#') ? raw.slice(1) : raw;
  const [p, q = ''] = body.split('?');
  const path = (p || '/').replace(/\/+$/, '') || '/';
  return { path, query: new URLSearchParams(q), hash: raw };
}

let cached = parse();
let cachedHash = cached.hash;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => { cached = parse(); cachedHash = cached.hash; listeners.forEach(l => l()); });
}
function getSnapshot(): Route {
  if (typeof location !== 'undefined' && location.hash !== cachedHash) { cached = parse(); cachedHash = cached.hash; }
  return cached;
}

export function useRoute(): Route {
  return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, getSnapshot, getSnapshot);
}

export function navigate(path: string, query?: Record<string, string | null | undefined>) {
  const qs = query ? Object.entries(query).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`).join('&') : '';
  location.hash = qs ? `${path}?${qs}` : path;
}

export function href(path: string, query?: Record<string, string | null | undefined>): string {
  const qs = query ? Object.entries(query).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`).join('&') : '';
  return `#${path}${qs ? `?${qs}` : ''}`;
}

/** '/tasks/:id' 패턴 매칭 */
export function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split('/').filter(Boolean);
  const b = path.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

/** 기존 경로 → 실제 경로 alias. 변경표는 docs/IMPLEMENTATION_REPORT.md 참조. */
export const ROUTE_ALIASES: Record<string, string> = {
  '/': '/office',
  '/setup': '/settings/connections',
  '/room': '/office/room',
};
