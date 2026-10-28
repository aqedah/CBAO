import { getStore, useStoreState } from '../../store/workspaceStore';

/** S62 정책. 이 빌드에서는 UI 설정(움직임·소리·업무명 숨기기)과 고정 정책 표시만 제공한다. */
export function PoliciesPage() {
  const ws = useStoreState(s => s.workspace);
  if (!ws) return <p className="empty">데이터가 없습니다.</p>;
  const set = (patch: Partial<typeof ws.ui>) => void getStore().command({ type: 'update_ui', patch });
  return (
    <>
      <div className="page-head"><h1>정책</h1></div>
      <section className="card">
        <h2>실행 정책 (고정)</h2>
        <ul>
          <li>PC당 관리형 실행 1개. 사무실에 5명이 보여도 5개 실행을 자동 시작하지 않습니다.</li>
          <li>자동 병합·배포·main 직접 수정·force push 없음. 업무 완료는 사용자 승인으로만 됩니다.</li>
          <li>일반 ChatGPT/Gemini/NotebookLM 웹 탭을 자동 관찰하지 않습니다. 외부 작업은 사용자 직접 보고로 기록합니다.</li>
          <li>상태 지연 45초 / 연결 끊김 90초는 초기 임계값이며, 끊김을 실행 실패로 바꾸지 않습니다.</li>
        </ul>
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
