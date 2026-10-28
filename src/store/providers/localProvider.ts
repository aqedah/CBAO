/**
 * 로컬 모드: 서버가 아직 없을 때 쓰는 provider.
 * - 브라우저 localStorage 에 workspace 를 저장한다. (서버·DB 가 아니며 다른 기기와 공유되지 않는다)
 * - Runner 연결이 없으므로 관리형 실행은 생기지 않는다. 외부 작업의 사용자 직접 보고와 승인만 가능하다.
 * - 데모 fixture 를 절대 주입하지 않는다.
 */
import type { Member, Workspace } from '../../domain/types';
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

/**
 * 소유자가 지시한 초기 팀원 (2026-10-28): Gemini 와 NotebookLM 을 서로 다른 외부 작업 팀원으로 등록하고 각 자리에 연결한다.
 * 외부 작업이므로 Runner·heartbeat 가 없고, 상태는 사용자 직접 보고로만 바뀐다. 데모 fixture 가 아니다.
 * 이미 저장된 로컬 workspace 에는 적용하지 않는다 (처음 만들 때만).
 */
export const INITIAL_MEMBERS: Member[] = [
  { member_id: 'm-gemini', display_name: 'Gemini', role_label: '자료·이미지', execution_mode: 'external', tool_label: 'Gemini 웹', connection_state: 'unknown', last_heartbeat_at: null, capabilities: { request_cancel: false } },
  { member_id: 'm-notebooklm', display_name: 'NotebookLM', role_label: '출처·문서 정리', execution_mode: 'external', tool_label: 'NotebookLM 웹', connection_state: 'unknown', last_heartbeat_at: null, capabilities: { request_cancel: false } },
];

export function initialLocalWorkspace(nowIso: string): Workspace {
  const ws = emptyLocalWorkspace(nowIso);
  return { ...ws, revision: 1, members: [...INITIAL_MEMBERS], ui: { ...ws.ui, seat_bindings: { gemini: 'm-gemini', notebooklm: 'm-notebooklm' } } };
}

interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }

function readStorage(storage: StorageLike | null, nowIso: string): Workspace {
  if (!storage) return initialLocalWorkspace(nowIso);
  try {
    const raw = storage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return initialLocalWorkspace(nowIso);
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
