import { useState } from 'react';
import { href } from '../../app/router';
import { getStore, useStoreState } from '../../store/workspaceStore';
import { Badge, ExternalLink, formatTime } from '../../shared/ui';
import { EVIDENCE_LABEL, RUN_STATUS_LABEL, TASK_STATUS_LABEL } from '../../domain/types';
import { CommandError, newIdempotencyKey } from '../../store/commands';

/** S32 단일 업무 화면: 지시·단계·실행·결과·인계. */
export function TaskDetailPage({ taskId }: { taskId: string }) {
  const ws = useStoreState(s => s.workspace);
  const [msg, setMsg] = useState<string | null>(null);
  if (!ws) return <p className="empty">데이터가 없습니다.</p>;
  const task = ws.tasks.find(t => t.task_id === taskId);
  if (!task) return <div className="card"><h1>작업을 찾을 수 없습니다</h1><p className="meta">{taskId}</p><a href={href('/tasks')}>작업함</a></div>;
  const member = ws.members.find(m => m.member_id === task.assignee_member_id);
  const runs = ws.runs.filter(r => r.task_id === task.task_id).sort((a, b) => b.sequence - a.sequence);
  const reports = ws.external_reports.filter(r => r.task_id === task.task_id).sort((a, b) => b.sequence - a.sequence);
  const handoffs = ws.handoffs.filter(h => h.task_id === task.task_id);
  const artifacts = ws.artifacts.filter(a => a.task_id === task.task_id);
  const approvals = ws.approvals.filter(a => a.task_id === task.task_id);

  const requestRun = async () => {
    if (!window.confirm(`"${task.title}" 실행을 요청할까요? Runner(실행 PC)가 받아가면 PC에서 ${member?.tool_label || '실행 도구'}가 지정 폴더 안에서 작업합니다. 결과는 승인 전까지 완료가 아닙니다.`)) return;
    try { await getStore().command({ type: 'request_run', task_id: task.task_id, expected_revision: task.revision, idempotency_key: newIdempotencyKey() }); setMsg('실행 요청을 기록했습니다. Runner 가 받아가면 실행 기록이 생깁니다.'); }
    catch (e) { setMsg(e instanceof CommandError ? e.message : '요청 실패'); }
  };
  const project = ws.projects.find(p => p.project_id === task.project_id);
  const canPublish = task.status === 'done' && !!project?.repo_reference && runs.length > 0;
  const requestPublish = async () => {
    if (!window.confirm(`승인된 변경을 GitHub 저장소(${project?.repo_reference})의 검토용 브랜치에 올릴까요? 실제 사이트 반영(main 합치기)은 GitHub에서 따로 눌러야 합니다.`)) return;
    try { await getStore().command({ type: 'request_publish', task_id: task.task_id, idempotency_key: newIdempotencyKey() }); setMsg('올리기 요청을 기록했습니다. Runner 가 처리하면 아래에 링크가 생깁니다.'); }
    catch (e) { setMsg(e instanceof CommandError ? e.message : '요청 실패'); }
  };
  const activeRun = runs.find(r => ['queued', 'leased', 'starting', 'running', 'waiting_input', 'stopping'].includes(r.status));
  const canRequestRun = member && (member.execution_mode === 'managed' || member.execution_mode === 'observed') && ['ready', 'needs_changes'].includes(task.status) && !activeRun;
  const requestCancel = async (runId: string) => {
    if (!window.confirm('이 실행에 중지 요청을 보낼까요? 요청만으로 종료가 확인되지는 않습니다. Runner 의 종료 확인이 올 때까지 "전달 대기"로 표시됩니다.')) return;
    try { await getStore().command({ type: 'request_cancel', run_id: runId, idempotency_key: newIdempotencyKey() }); setMsg('중지 요청을 기록했습니다. 전달·종료 확인을 기다립니다.'); }
    catch (e) { setMsg(e instanceof CommandError ? e.message : '요청 실패'); }
  };

  return (
    <>
      <div className="page-head">
        <h1>{task.title}</h1>
        <Badge tone={task.status === 'awaiting_owner' || task.status === 'blocked' ? 'attention' : task.status === 'active' || task.status === 'done' ? 'active' : 'muted'}>{TASK_STATUS_LABEL[task.status]}</Badge>
        <span className="spacer" />
        {member?.execution_mode === 'external' && <a className="btn" href={href(`/tasks/${task.task_id}/external-report`)}>결과·상태 직접 보고</a>}
        <a className="btn" href={href('/tasks/new', { project: task.project_id, assignee: task.assignee_member_id })}>이 담당에게 새 지시</a>
        {canRequestRun && (task.run_requested_at
          ? <span className="badge attention">실행 요청됨 · Runner 대기 ({formatTime(task.run_requested_at)})</span>
          : <button className="btn primary" type="button" onClick={() => void requestRun()}>실행 요청</button>)}
      </div>
      {msg && <div className="notice" role="status">{msg}</div>}
      {canPublish && (
        <div className="notice info">
          {!task.publish || task.publish.status === 'failed' ? (
            <>{task.publish?.status === 'failed' && <div className="meta">이전 시도 실패: {task.publish.message}</div>}<button className="btn primary" type="button" onClick={() => void requestPublish()}>GitHub에 올리기 (검토용 브랜치)</button></>
          ) : task.publish.status === 'pending' ? '올리기 요청됨 · Runner 처리 대기' : task.publish.status === 'nothing_to_publish' ? '올릴 변경이 없습니다 (파일이 바뀌지 않음)' : (
            <>브랜치 <code>{task.publish.branch}</code> 에 올렸습니다 ({formatTime(task.publish.at)}). {task.publish.compare_url && <ExternalLink href={task.publish.compare_url}>GitHub에서 합치기(PR) 열기</ExternalLink>}</>
          )}
        </div>
      )}
      <div className="grid-2">
        <section className="card">
          <h2>지시</h2>
          <dl className="kv">
            <dt>ID</dt><dd>{task.task_id} (rev {task.revision})</dd>
            <dt>프로젝트</dt><dd>{task.project_id}</dd>
            <dt>담당</dt><dd>{member ? `${member.display_name} · ${member.role_label}` : '미배정'}</dd>
            <dt>목적</dt><dd>{task.goal || '—'}</dd>
            <dt>완료 조건</dt><dd>{task.done_criteria || '—'}</dd>
            <dt>생성/갱신</dt><dd>{formatTime(task.created_at)} / {formatTime(task.updated_at)}</dd>
          </dl>
        </section>
        <section className="card">
          <h2>실행</h2>
          {runs.length === 0 ? <p className="empty">실행 기록이 없습니다. {member?.execution_mode === 'external' ? '외부 작업은 실행 기록 대신 직접 보고로 추적합니다.' : 'Runner 연결 후 실행이 시작되면 여기에 표시됩니다.'}</p> : (
            <ul className="list">
              {runs.map(r => (
                <li key={r.run_id}>
                  <div className="row"><strong>{r.run_id}</strong> <Badge tone={r.status === 'running' ? 'active' : r.status === 'failed' ? 'error' : 'muted'}>{RUN_STATUS_LABEL[r.status]}</Badge> <span className="meta">{r.phase}</span></div>
                  <div className="meta">근거: {EVIDENCE_LABEL[r.evidence_source]} · 마지막 확인 {formatTime(r.last_confirmed_at)}</div>
                  {r.cancel_requested_at && <div className="meta">중지 요청 {formatTime(r.cancel_requested_at)} · {r.cancel_delivery === 'pending' ? '전달 대기' : r.cancel_delivery === 'delivered' ? '전달됨 · 종료 미확인' : r.cancel_delivery === 'confirmed' ? '종료 확인' : ''}</div>}
                  {r.status === 'succeeded' && <div className="dim-note">실행 종료는 업무 완료가 아닙니다. 결과물 제출과 승인은 별도입니다.</div>}
                  {r.observed && <div className="dim-note">터미널에서 직접 실행한 세션 — 사무실은 관찰만 합니다 (중지·반영 불가)</div>}
                  {member?.capabilities.request_cancel && !r.observed && ['starting', 'running', 'waiting_input'].includes(r.status) && (
                    <button className="btn small danger" type="button" onClick={() => void requestCancel(r.run_id)} style={{ marginTop: 6 }}>중지 요청</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h2>직접 보고 (외부 작업)</h2>
          {reports.length === 0 ? <p className="empty">직접 보고가 없습니다.</p> : (
            <ul className="list">
              {reports.map(r => (
                <li key={r.report_id}>
                  <div className="row"><Badge tone="attention">{r.status === 'working' ? '작업 중' : r.status === 'submitted' ? '결과 제출' : '막힘'}</Badge> <span className="meta">사용자 직접 보고 · {formatTime(r.reported_at)}</span></div>
                  <div>{r.note}</div>
                  {r.link && <div><ExternalLink href={r.link}>링크 열기</ExternalLink></div>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h2>결과물 · 승인 · 인계</h2>
          {artifacts.length === 0 && approvals.length === 0 && handoffs.length === 0 && <p className="empty">기록이 없습니다.</p>}
          <ul className="list">
            {artifacts.map(a => <li key={a.artifact_id}><strong>{a.title}</strong> <span className="meta">{a.kind} · {formatTime(a.submitted_at)}</span></li>)}
            {approvals.map(a => <li key={a.approval_id}>승인 요청: {a.summary} <span className="meta">{a.decision ? `결정 ${a.decision} (${formatTime(a.decided_at)})` : '대기 중'}</span> {!a.decision && <a href={href('/approvals')}>승인함</a>}</li>)}
            {handoffs.map(h => <li key={h.handoff_id}>인계: {ws.members.find(m => m.member_id === h.from_member_id)?.display_name} → {ws.members.find(m => m.member_id === h.to_member_id)?.display_name} · {h.summary} <span className="meta">{h.accepted_at ? `수락 ${formatTime(h.accepted_at)}` : '수락 대기'}</span></li>)}
          </ul>
        </section>
      </div>
    </>
  );
}
