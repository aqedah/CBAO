/**
 * 서버(HTTP) provider — v1 명세 §API 를 따르는 최소 클라이언트.
 * 이 세션에는 실제 서버가 없어 동작을 검증하지 못했다(미검증). 주소가 설정되지 않으면 '미설정' 오류를 낸다.
 * 인증 토큰·API 키는 여기 하드코딩하지 않는다. 브라우저 쿠키/세션 인증을 전제로 credentials: 'include' 를 쓴다.
 */
import type { Workspace } from '../../domain/types';
import type { Command } from '../commands';
import { ProviderNotConfiguredError, type WorkspaceProvider } from './types';

export function createHttpProvider(baseUrl: string | undefined, fetchImpl: typeof fetch = fetch): WorkspaceProvider {
  let offset = 0;
  const base = (baseUrl ?? '').replace(/\/$/, '');
  const ensure = () => {
    if (!base) throw new ProviderNotConfiguredError('서버 주소(VITE_AI_OFFICE_API)가 설정되지 않았습니다.');
    if (!/^https:\/\//.test(base) && !/^http:\/\/localhost(:\d+)?$/.test(base)) {
      throw new ProviderNotConfiguredError('서버 주소는 https 또는 localhost 만 허용합니다.');
    }
  };
  const parse = async (res: Response): Promise<Workspace> => {
    if (!res.ok) throw new Error(`서버 오류 ${res.status}`);
    const serverDate = res.headers.get('date');
    if (serverDate) {
      const parsed = Date.parse(serverDate);
      if (Number.isFinite(parsed)) offset = parsed - Date.now();
    }
    const body = (await res.json()) as Workspace;
    if (body.is_demo) throw new Error('서버가 데모 데이터를 보냈습니다. live 모드에서는 거부합니다.');
    return body;
  };
  return {
    info: { id: 'http', label: '서버 연결', description: '기존 서버 API 를 통해 인증·권한·Runner 근거를 받습니다. (이 빌드에서는 미검증)', provides_live_runs: true },
    async load() {
      ensure();
      return parse(await fetchImpl(`${base}/api/workspace`, { credentials: 'include' }));
    },
    subscribe(onWorkspace, onError) {
      // 서버 push(SSE)가 있으면 사용하고, 없으면 20초 polling. 역순 응답은 store 가 revision 으로 거부한다.
      let stopped = false;
      const tick = async () => {
        if (stopped) return;
        try { onWorkspace(await this.load()); } catch (e) { onError(e instanceof Error ? e : new Error(String(e))); }
      };
      const id = setInterval(tick, 20_000);
      return () => { stopped = true; clearInterval(id); };
    },
    async command(cmd: Command) {
      ensure();
      const idem = 'idempotency_key' in cmd ? cmd.idempotency_key : undefined;
      return parse(await fetchImpl(`${base}/api/commands`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json', ...(idem ? { 'idempotency-key': idem } : {}) },
        body: JSON.stringify(cmd),
      }));
    },
    clockOffsetMs: () => offset,
  };
}
