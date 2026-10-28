/**
 * 로컬 모드: 서버가 아직 없을 때 쓰는 provider.
 * - 브라우저 localStorage 에 workspace 를 저장한다. (서버·DB 가 아니며 다른 기기와 공유되지 않는다)
 * - Runner 연결이 없으므로 관리형 실행은 생기지 않는다. 외부 작업의 사용자 직접 보고와 승인만 가능하다.
 * - 데모 fixture 를 절대 주입하지 않는다.
 */
import type { Workspace } from '../../domain/types';
import { applyCommand, type Command } from '../commands';
import type { WorkspaceProvider } from './types';

export const LOCAL_STORAGE_KEY = 'ai-office.local-workspace.v1';

export function emptyLocalWorkspace(nowIso: string): Workspace {
  return {
    workspace_id: 'local-workspace',
    is_demo: false,
    revision: 0,
    captured_at: nowIso,
    projects: [], members: [], tasks: [], runs: [], external_reports: [], approvals: [], handoffs: [], artifacts: [],
    devices: [],
    ui: { seat_bindings: {}, motion_enabled: true, sound_enabled: false, privacy_mode: false },
  };
}

interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }

function readStorage(storage: StorageLike | null, nowIso: string): Workspace {
  if (!storage) return emptyLocalWorkspace(nowIso);
  try {
    const raw = storage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return emptyLocalWorkspace(nowIso);
    const parsed = JSON.parse(raw) as Workspace;
    if (parsed.is_demo) throw new Error('로컬 저장소에 데모 데이터가 섞여 있습니다. 초기화가 필요합니다.');
    if (parsed.workspace_id !== 'local-workspace' || !Number.isInteger(parsed.revision)) return emptyLocalWorkspace(nowIso);
    return { ...emptyLocalWorkspace(nowIso), ...parsed, ui: { ...emptyLocalWorkspace(nowIso).ui, ...parsed.ui } };
  } catch (e) {
    if (e instanceof Error && e.message.includes('데모')) throw e;
    return emptyLocalWorkspace(nowIso);
  }
}

export function createLocalProvider(storage: StorageLike | null, now: () => Date = () => new Date()): WorkspaceProvider {
  let ws: Workspace | null = null;
  const persist = (next: Workspace) => {
    try { storage?.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next)); } catch { /* 저장 실패는 화면에서 revision 으로 알 수 있다 */ }
  };
  return {
    info: { id: 'local', label: '로컬 (서버 미연결)', description: '이 브라우저에만 저장. Runner 없음 → 관리형 실행 불가, 수동 보고만 가능.', provides_live_runs: false },
    async load() {
      ws = readStorage(storage, now().toISOString());
      return ws;
    },
    async command(cmd: Command) {
      if (!ws) ws = readStorage(storage, now().toISOString());
      const next = applyCommand(ws, cmd, now().toISOString());
      if (next !== ws) { ws = next; persist(ws); }
      return ws;
    },
    clockOffsetMs: () => 0,
  };
}
