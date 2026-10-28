import { getStore, useStoreState } from '../../store/workspaceStore';
import { formatTime } from '../../shared/ui';
import type { RunnerPolicy } from '../../domain/types';

/**
 * 정책. 실행 정책은 Runner 가 heartbeat 에 실어 보낸 실제 강제 데이터(policy)를 그대로 보여 준다.
 * Runner 가 연결되지 않았으면 '미확인'이지 '차단됨'이 아니다 (문구만으로 차단을 주장하지 않는다).
 */
export function PoliciesPage() {
  const ws = useStoreState(s => s.workspace);
  if (!ws) return <p className="empty">데이터가 없습니다.</p>;
  const set = (patch: Partial<typeof ws.ui>) => void getStore().command({ type: 'update_ui', patch });
  const device = ws.devices.find(d => d.policy) ?? ws.devices[0];
  const policy: RunnerPolicy | null | undefined = device?.policy;
  const live = device?.connection_state === 'healthy';
  return (
    <>
      <div className="page-head"><h1>정책</h1></div>
      <section className="card">
        <h2>실행 정책 — 심부름꾼이 실제로 강제하는 범위</h2>
        {!policy ? (
          <div className="notice">실행 PC 에서 심부름꾼(0.8.0 이상)이 연결되면 실제 허용 목록이 여기에 나옵니다. 지금은 <strong>미확인</strong>입니다. 아래 고정 원칙은 설계 의도이며, 연결 전에는 강제되었다고 볼 수 없습니다.</div>
        ) : (
          <p className="meta">{device?.name} · 심부름꾼 {policy.runner_version} · 정책 rev {policy.revision} · 보고 {formatTime(policy.reported_at ?? null)} {live ? '(연결 중)' : '(마지막 보고 기준 — 지금은 미연결)'} · 장부 UID <code>{device?.workspace_uid ?? '?'}</code></p>
        )}
        <ul>
          {(policy?.rules ?? [
            'PC당 관리형 실행 1개. 사무실에 5명이 보여도 5개 실행을 자동 시작하지 않습니다.',
            '자동 병합·배포·force push 없음. 반영은 소유자 버튼으로만. 업무 완료는 사용자 승인으로만 됩니다.',
            '일반 ChatGPT/Gemini/NotebookLM 웹 탭을 자동 관찰하지 않습니다. 외부 작업은 사용자 직접 보고로 기록합니다.',
            '상태 지연 45초 / 연결 끊김 90초는 초기 임계값이며, 끊김을 실행 실패로 바꾸지 않습니다.',
          ]).map((r, i) => <li key={i}>{r}</li>)}
        </ul>
        {policy && (
          <>
            <h3>도구별 허용 범위 (논의 모드 / 실행 모드)</h3>
            <table className="policy-table">
              <thead><tr><th>도구</th><th>설치</th><th>논의 모드 (읽기만)</th><th>실행 모드</th><th>강제 수단</th></tr></thead>
              <tbody>
                {Object.entries(policy.tools).map(([k, t]) => (
                  <tr key={k}>
                    <td><strong>{k}</strong></td>
                    <td>{t.installed ? '있음' : '없음'}</td>
                    <td><code style={{ whiteSpace: 'pre-wrap', fontSize: '.78rem' }}>{t.discuss.join('\n')}</code></td>
                    <td><code style={{ whiteSpace: 'pre-wrap', fontSize: '.78rem' }}>{t.exec.join('\n')}</code></td>
                    <td className="meta">{t.enforced_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>기능 지원 여부 (capability)</h3>
            <table className="policy-table">
              <thead><tr><th>기능</th>{Object.keys(policy.tools).map(k => <th key={k}>{k}</th>)}</tr></thead>
              <tbody>
                {Object.keys(policy.tools.claude?.capabilities ?? {}).map(cap => (
                  <tr key={cap}><td>{CAP_LABEL[cap] ?? cap}</td>{Object.entries(policy.tools).map(([k, t]) => <td key={k} className={`cap-${t.capabilities[cap] ?? 'unverified'}`}>{CAP_STATE[t.capabilities[cap] ?? 'unverified']}</td>)}</tr>
                ))}
              </tbody>
            </table>
            <p className="meta">보호 경로 (체크포인트에서 항상 제외): {policy.protected_paths.join(', ')}</p>
            <p className="meta">실행 모드의 <code>npm run*</code>·<code>python *</code> 같은 규칙은 프로젝트 스크립트 전체를 돌릴 수 있는 넓은 규칙입니다. 저장소 밖 쓰기와 네트워크는 도구 샌드박스·OS 범위를 따르며, 이 화면은 그것까지 보장하지 않습니다.</p>
          </>
        )}
      </section>
      <section className="card">
        <h2>화면 설정 (사용자별 UI, 서버 권한 대체 아님)</h2>
        <label className="row"><input type="checkbox" checked={ws.ui.motion_enabled} onChange={e => set({ motion_enabled: e.target.checked })} /> 픽셀 사무실 움직임 (확인된 실행에서만 동작)</label>
        <label className="row"><input type="checkbox" checked={ws.ui.privacy_mode} onChange={e => set({ privacy_mode: e.target.checked })} /> 업무명 숨기기 (촬영·화면 공유용: 프로젝트명·작업명 숨김, 역할·상태만 표시)</label>
        <label className="row"><input type="checkbox" checked={ws.ui.sound_enabled} onChange={e => set({ sound_enabled: e.target.checked })} /> 소리 (기본 꺼짐 · 이 빌드에는 재생할 소리 에셋이 없습니다)</label>
      </section>
    </>
  );
}

const CAP_LABEL: Record<string, string> = {
  conversation: '대화', read_only: '읽기 전용 강제', scoped_write: '범위 안 쓰기', stream_text: '응답 중계', steer_active_turn: '실행 중 끼어들기',
  interrupt: '중지', resume_session: '세션 이어가기', structured_review: '구조화 검토(JSON)', accept_attachments: '첨부 받기',
};
const CAP_STATE: Record<string, string> = { supported: '지원', unsupported: '미지원', unverified: '미검증' };
