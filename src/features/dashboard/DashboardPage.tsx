import { href } from '../../app/router';
import { useStoreState } from '../../store/workspaceStore';
import { Badge, StateIcon, formatAge, formatTime, useServerNow } from '../../shared/ui';
import { EVIDENCE_LABEL, EXEC_MODE_LABEL, TASK_STATUS_LABEL } from '../../domain/types';
import { OfficeHeader } from '../office-shared/OfficeHeader';
import { useMemberViews, useOfficeSnapshot, useProjectFilter } from '../office-shared/useOfficeSnapshot';

/** S10 메인 대시보드. 우선순위: 사용자 결정 → 팀원 현황 → 진행 작업 → 최근 결과. */
export function DashboardPage() {
  const ws = useStoreState(s => s.workspace);
  const status = useStoreState(s => s.status);
  const snapshot = useOfficeSnapshot();
  const views = useMemberViews(snapshot, { reducedMotion: true, hidden: true, motionEnabled: false });
  const project = useProjectFilter();
  const now = useServerNow();

  if (!ws) {
    return (
      <>
        <OfficeHeader view="dashboard" />
        {status === 'not_configured' && <div className="notice">서버 주소가 설정되지 않았습니다. <a href={href('/settings/connections')}>연결 설정</a>에서 로컬 모드를 고르거나 서버 주소를 지정하세요.</div>}
        {status === 'error' && <div className="notice error">데이터를 불러오지 못했습니다. <a href={href('/settings/connections')}>연결 설정</a>에서 확인하세요.</div>}
      </>
    );
  }

  const inProject = (pid: string) => !project || pid === project;
  const decisions = ws.approvals.filter(a => a.decision === null && inProject(a.project_id)).sort((a, b) => b.sequence - a.sequence);
  const openTasks = ws.tasks.filter(t => inProject(t.project_id) && !['done', 'cancelled', 'draft'].includes(t.status)).sort((a, b) => b.sequence - a.sequence);
  const recent = ws.artifacts.filter(a => { const t = ws.tasks.find(x => x.task_id === a.task_id); return t && inProject(t.project_id); }).slice(-5).reverse();
  const device = ws.devices[0];

  return (
    <>
      <OfficeHeader view="dashboard" />
      <div className="card">
        <h2>연결</h2>
        {device ? (
          <p className="row">
            <strong>{device.name}</strong>
            <Badge tone={device.connection_state === 'healthy' ? 'active' : device.connection_state === 'delayed' ? 'attention' : 'muted'}>{device.connection_state}</Badge>
            <span className="meta">마지막 heartbeat {formatTime(device.last_heartbeat_at)} ({formatAge(device.last_heartbeat_at, now)})</span>
            <span className="meta">관리형 실행 한도 PC당 {device.max_concurrent_managed_runs}개</span>
          </p>
        ) : <p className="empty">등록된 실행 PC가 없습니다. 관리형 실행은 <a href={href('/settings/connections')}>연결 설정</a>에서 PC와 도구를 연결한 뒤 가능합니다.</p>}
      </div>

      <section className="card" aria-labelledby="h-decisions">
        <h2 id="h-decisions">내 결정이 필요한 일 {decisions.length > 0 && <Badge tone="count">{decisions.length}</Badge>}</h2>
        {decisions.length === 0 ? <p className="empty">지금 결정할 일이 없습니다.</p> : (
          <ul className="list">
            {decisions.map(a => {
              const task = ws.tasks.find(t => t.task_id === a.task_id);
              return (
                <li key={a.approval_id}>
                  <div className="row"><strong>{a.project_id}</strong> / {task?.title ?? a.task_id} <Badge tone="attention">{a.kind === 'result' ? '결과 승인' : a.kind === 'judgment' ? '내용 판단' : '범위·권한'}</Badge></div>
                  <div className="meta">{a.summary} · 요청 {formatTime(a.requested_at)}</div>
                  <div className="row" style={{ marginTop: 6 }}>
                    <a className="btn small" href={href('/approvals')}>근거·대안 보기</a>
                    {task && <a className="btn small" href={href(`/tasks/${task.task_id}`)}>작업 열기</a>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="h-members">
        <h2 id="h-members">팀원 자리</h2>
        {ws.members.length === 0 ? <p className="empty">등록된 팀원이 없습니다. <a href={href('/settings/team')}>팀원·자리 설정</a>에서 팀원을 등록하고 자리를 연결하세요.</p> : (
          <table>
            <thead><tr><th>팀원</th><th>역할 / 연결</th><th>상태</th><th>현재 업무</th><th>근거 · 마지막 확인</th><th></th></tr></thead>
            <tbody>
              {snapshot?.members.map(m => {
                const v = views.get(m.member_id)!;
                const other = m.task && !inProject(m.task.project_id);
                return (
                  <tr key={m.member_id}>
                    <td><strong>{m.display_name}</strong></td>
                    <td>{m.role_label}<div className="meta">{EXEC_MODE_LABEL[m.execution_mode]}</div></td>
                    <td><Badge tone={v.color}><StateIcon icon={v.icon} /> {v.label}</Badge>{v.pendingOwnerCount > 0 && <> <Badge tone="count">{v.pendingOwnerCount}</Badge></>}</td>
                    <td>{m.task ? <a href={href(`/tasks/${m.task.task_id}`)}>{m.task.project_id} / {m.task.title}</a> : <span className="meta">배정된 업무 없음</span>}{other && <div className="dim-note">다른 프로젝트 작업 중</div>}</td>
                    <td className="meta">{EVIDENCE_LABEL[v.evidence]}<br />{formatTime(v.lastConfirmedAt)} {v.lastConfirmedAt && `(${formatAge(v.lastConfirmedAt, now)})`}</td>
                    <td><a className="btn small" href={href('/office/room', { project, member: m.member_id })}>자리 보기</a></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <div className="grid-2">
        <section className="card" aria-labelledby="h-tasks">
          <h2 id="h-tasks">진행 작업 ({openTasks.length})</h2>
          {openTasks.length === 0 ? <p className="empty">진행 중인 작업이 없습니다.</p> : (
            <ul className="list">
              {openTasks.slice(0, 8).map(t => (
                <li key={t.task_id}>
                  <div className="row"><a href={href(`/tasks/${t.task_id}`)}>{t.title}</a> <Badge tone={t.status === 'awaiting_owner' || t.status === 'blocked' ? 'attention' : t.status === 'active' ? 'active' : 'muted'}>{TASK_STATUS_LABEL[t.status]}</Badge></div>
                  <div className="meta">{t.project_id} · 담당 {ws.members.find(m => m.member_id === t.assignee_member_id)?.display_name ?? '미배정'} · rev {t.revision}</div>
                </li>
              ))}
            </ul>
          )}
          <p style={{ marginTop: 8 }}><a href={href('/tasks', { project })}>전체 보기 →</a></p>
        </section>
        <section className="card" aria-labelledby="h-recent">
          <h2 id="h-recent">최근 결과</h2>
          {recent.length === 0 ? <p className="empty">제출된 결과물이 없습니다.</p> : (
            <ul className="list">
              {recent.map(a => <li key={a.artifact_id}><strong>{a.title}</strong><div className="meta">{a.kind} · {formatTime(a.submitted_at)} · {a.content_hash ? `hash ${a.content_hash.slice(0, 10)}` : '해시 없음'}</div></li>)}
            </ul>
          )}
          <p style={{ marginTop: 8 }}><a href={href('/records')}>기록·자료 →</a></p>
        </section>
      </div>
    </>
  );
}
