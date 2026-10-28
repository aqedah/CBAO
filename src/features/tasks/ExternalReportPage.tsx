import { useState, type FormEvent } from 'react';
import { href, navigate } from '../../app/router';
import { getStore, useStoreState } from '../../store/workspaceStore';
import { CommandError, newIdempotencyKey } from '../../store/commands';
import type { ExternalReportStatus } from '../../domain/types';

/** 외부 작업(ChatGPT/Gemini/NotebookLM 웹)의 시작·완료를 사용자가 직접 보고한다. 자동 관찰이 아니다. */
export function ExternalReportPage({ taskId }: { taskId: string }) {
  const ws = useStoreState(s => s.workspace);
  const [status, setStatus] = useState<ExternalReportStatus>('working');
  const [note, setNote] = useState('');
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(() => newIdempotencyKey());
  if (!ws) return <p className="empty">데이터가 없습니다.</p>;
  const task = ws.tasks.find(t => t.task_id === taskId);
  const member = task ? ws.members.find(m => m.member_id === task.assignee_member_id) : null;
  if (!task) return <p className="empty">작업을 찾을 수 없습니다.</p>;
  if (!member || member.execution_mode !== 'external') return <div className="notice">이 작업의 담당은 외부 작업 팀원이 아닙니다. 직접 보고는 외부 작업에만 등록합니다.</div>;

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError(null);
    try {
      await getStore().command({ type: 'submit_external_report', task_id: task.task_id, member_id: member.member_id, status, note, link: link || null, idempotency_key: key });
      navigate(`/tasks/${task.task_id}`);
    } catch (err) { setError(err instanceof CommandError ? err.message : '저장 실패'); }
  };
  return (
    <>
      <div className="page-head"><h1>직접 보고 — {task.title}</h1></div>
      <div className="notice info">이 보고는 <strong>사용자 직접 보고</strong>로 기록되며 보고 시각이 함께 표시됩니다. 자동 연결·heartbeat 로 승격되지 않습니다. '결과 제출'은 승인함에 결과 승인 요청을 만들고, 업무 완료는 승인 후에만 됩니다.</div>
      <form className="stack" onSubmit={submit}>
        <label>담당<input value={`${member.display_name} · ${member.tool_label || '외부 서비스'}`} readOnly /></label>
        <label>상태
          <select value={status} onChange={e => setStatus(e.target.value as ExternalReportStatus)}>
            <option value="working">작업 시작/진행 중</option>
            <option value="submitted">결과 제출 (검토 요청)</option>
            <option value="blocked">막힘</option>
          </select>
        </label>
        <label>메모<textarea value={note} onChange={e => setNote(e.target.value)} /></label>
        <label>결과 링크 (https 만)<input value={link} onChange={e => setLink(e.target.value)} placeholder="https://" /></label>
        {error && <div className="notice error" role="alert">{error}</div>}
        <div className="row"><button className="btn primary" type="submit">보고 등록</button><a className="btn" href={href(`/tasks/${task.task_id}`)}>취소</a></div>
      </form>
    </>
  );
}
