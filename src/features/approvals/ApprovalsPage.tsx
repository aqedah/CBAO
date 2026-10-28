import { useState } from 'react';
import { href } from '../../app/router';
import { getStore, useStoreState } from '../../store/workspaceStore';
import { Badge, formatTime } from '../../shared/ui';
import { CommandError, newIdempotencyKey } from '../../store/commands';
import type { ApprovalDecision } from '../../domain/types';

/** S40 승인함. 결과 승인 / 내용 판단 / 범위·권한. 그림 안에서 승인하지 않는다. */
export function ApprovalsPage() {
  const ws = useStoreState(s => s.workspace);
  const [msg, setMsg] = useState<string | null>(null);
  if (!ws) return <p className="empty">데이터가 없습니다.</p>;
  const pending = ws.approvals.filter(a => a.decision === null).sort((a, b) => b.sequence - a.sequence);
  const decided = ws.approvals.filter(a => a.decision !== null).sort((a, b) => b.sequence - a.sequence);
  const decide = async (id: string, decision: ApprovalDecision) => {
    const a = ws.approvals.find(x => x.approval_id === id)!;
    const task = ws.tasks.find(t => t.task_id === a.task_id)!;
    const label = decision === 'approved' ? '승인' : decision === 'needs_changes' ? '보완 요청' : '반려';
    if (!window.confirm(`"${task.title}" 을(를) ${label} 처리할까요?`)) return;
    try { await getStore().command({ type: 'decide_approval', approval_id: id, decision, expected_revision: task.revision, idempotency_key: newIdempotencyKey() }); setMsg(`${label} 처리했습니다.`); }
    catch (e) { setMsg(e instanceof CommandError ? e.message : '처리 실패'); }
  };
  return (
    <>
      <div className="page-head"><h1>승인함</h1>{pending.length > 0 && <Badge tone="count">{pending.length}</Badge>}</div>
      {msg && <div className="notice" role="status">{msg}</div>}
      {pending.length === 0 ? <p className="empty">대기 중인 승인 요청이 없습니다.</p> : (
        <ul className="list">
          {pending.map(a => {
            const task = ws.tasks.find(t => t.task_id === a.task_id);
            const member = ws.members.find(m => m.member_id === a.member_id);
            return (
              <li key={a.approval_id} className="card">
                <div className="row"><strong>{a.project_id}</strong> / {task ? <a href={href(`/tasks/${task.task_id}`)}>{task.title}</a> : a.task_id} <Badge tone="attention">{a.kind === 'result' ? '결과 승인' : a.kind === 'judgment' ? '내용 판단' : '범위·권한'}</Badge></div>
                <div>{a.summary}</div>
                <div className="meta">요청 {formatTime(a.requested_at)} · 요청자 {member?.display_name ?? '—'} · 작업 rev {task?.revision}</div>
                <div className="row" style={{ marginTop: 8 }}>
                  <button className="btn primary" type="button" onClick={() => void decide(a.approval_id, 'approved')}>승인</button>
                  <button className="btn" type="button" onClick={() => void decide(a.approval_id, 'needs_changes')}>보완 요청</button>
                  <button className="btn danger" type="button" onClick={() => void decide(a.approval_id, 'rejected')}>반려</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {decided.length > 0 && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>처리한 요청</h2>
          <ul className="list">{decided.map(a => <li key={a.approval_id}>{a.summary} <span className="meta">— {a.decision} · {formatTime(a.decided_at)}</span></li>)}</ul>
        </section>
      )}
    </>
  );
}
