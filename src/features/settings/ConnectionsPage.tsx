import { getStore, useStoreState } from '../../store/workspaceStore';
import { Badge, formatTime } from '../../shared/ui';
import type { DataSource } from '../../store/providers/types';

/** S60 연결 설정: 데이터 소스(서버/로컬/데모), 실행 PC, 도구 상태. */
export function ConnectionsPage() {
  const source = useStoreState(s => s.source);
  const status = useStoreState(s => s.status);
  const error = useStoreState(s => s.error);
  const ws = useStoreState(s => s.workspace);
  const apiUrl = import.meta.env.VITE_AI_OFFICE_API as string | undefined;
  const choose = (s: DataSource) => {
    if (s === 'demo' && !window.confirm('데모 모드를 켭니다. 가짜 데이터가 표시되며 모든 화면에 데모 배지가 붙습니다. 새로고침하면 데모 데이터는 사라집니다.')) return;
    void getStore().switchSource(s);
  };
  const toolLabel: Record<string, string> = { not_installed: '미설치', installed: '설치됨', logged_in: '로그인됨', test_passed: '실행 시험 통과', connected: '현재 연결됨' };
  return (
    <>
      <div className="page-head"><h1>연결</h1></div>
      <section className="card">
        <h2>데이터 소스</h2>
        <p className="meta">현재: <strong>{getStore().providerInfo.label}</strong> · {status} {error && <Badge tone="error">{error}</Badge>}</p>
        <table>
          <thead><tr><th>소스</th><th>설명</th><th>실제 Runner 근거</th><th></th></tr></thead>
          <tbody>
            <tr><td>서버 연결</td><td>기존 서버 API(인증·권한·Runner 이벤트). {apiUrl ? `주소: ${apiUrl}` : '주소 미설정 (VITE_AI_OFFICE_API). 이 빌드에서는 서버가 없어 미검증.'}</td><td>있음(서버가 제공)</td><td><button className="btn small" type="button" disabled={source === 'http'} onClick={() => choose('http')}>선택</button></td></tr>
            <tr><td>로컬 (서버 미연결)</td><td>이 브라우저에만 저장. 프로젝트·팀원 등록, 지시, 외부 작업 직접 보고, 승인 가능. Runner 없음 → 관리형 실행 없음.</td><td>없음</td><td><button className="btn small" type="button" disabled={source === 'local'} onClick={() => choose('local')}>선택</button></td></tr>
            <tr><td>데모</td><td>fixture 가짜 데이터. 화면·동작 확인용. 모든 화면에 데모 배지.</td><td>없음 (가짜)</td><td><button className="btn small" type="button" disabled={source === 'demo'} onClick={() => choose('demo')}>데모 켜기</button></td></tr>
          </tbody>
        </table>
      </section>
      <section className="card">
        <h2>실행 PC · 도구</h2>
        {!ws || ws.devices.length === 0 ? (
          <p className="empty">등록된 PC가 없습니다. PC 등록은 소유자가 만든 일회용 페어링 코드와 PC 에이전트(서버 모드)가 필요하며, 이 빌드에는 포함되어 있지 않습니다. '설치됨·로그인됨·실행 시험 통과·현재 연결됨'은 서로 다른 상태로 기록됩니다.</p>
        ) : ws.devices.map(d => (
          <div key={d.device_id}>
            <div className="row"><strong>{d.name}</strong> <Badge tone={d.connection_state === 'healthy' ? 'active' : 'muted'}>{d.connection_state}</Badge> <span className="meta">heartbeat {formatTime(d.last_heartbeat_at)} · 관리형 실행 한도 {d.max_concurrent_managed_runs}</span></div>
            <ul className="list" style={{ marginTop: 8 }}>{d.tools.map(t => <li key={t.tool}>{t.tool} — {toolLabel[t.status]}</li>)}</ul>
          </div>
        ))}
      </section>
    </>
  );
}
