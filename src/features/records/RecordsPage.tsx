import { href } from '../../app/router';
import { useStoreState } from '../../store/workspaceStore';
import { ExternalLink, formatTime } from '../../shared/ui';

export function RecordsPage({ tab }: { tab: 'all' | 'handoffs' }) {
  const ws = useStoreState(s => s.workspace);
  if (!ws) return <p className="empty">데이터가 없습니다.</p>;
  const name = (id: string | null) => ws.members.find(m => m.member_id === id)?.display_name ?? '—';
  return (
    <>
      <div className="page-head"><h1>기록·자료</h1>
        <div className="view-switch"><a href={href('/records')} aria-current={tab === 'all' ? 'page' : undefined}>결과물·보고</a><a href={href('/records/handoffs')} aria-current={tab === 'handoffs' ? 'page' : undefined}>인계·검토</a></div>
      </div>
      {tab === 'handoffs' ? (
        <section className="card"><h2>인계 기록</h2>
          {ws.handoffs.length === 0 ? <p className="empty">인계 기록이 없습니다.</p> : (
            <ul className="list">{ws.handoffs.map(h => <li key={h.handoff_id}>{name(h.from_member_id)} → {name(h.to_member_id)} · {h.summary} <span className="meta">요청 {formatTime(h.requested_at)} · {h.accepted_at ? `수락 ${formatTime(h.accepted_at)}` : '수락 대기'}</span> · <a href={href(`/tasks/${h.task_id}`)}>작업</a></li>)}</ul>
          )}
        </section>
      ) : (
        <div className="grid-2">
          <section className="card"><h2>결과물</h2>
            {ws.artifacts.length === 0 ? <p className="empty">결과물이 없습니다.</p> : <ul className="list">{ws.artifacts.map(a => <li key={a.artifact_id}><strong>{a.title}</strong> <span className="meta">{a.kind} · {name(a.member_id)} · {formatTime(a.submitted_at)}</span><div className="meta">{a.kind === 'link' ? <ExternalLink href={a.reference}>{a.reference}</ExternalLink> : a.reference}</div></li>)}</ul>}
          </section>
          <section className="card"><h2>직접 보고</h2>
            {ws.external_reports.length === 0 ? <p className="empty">직접 보고가 없습니다.</p> : <ul className="list">{ws.external_reports.map(r => <li key={r.report_id}>{name(r.member_id)} · {r.status} · {r.note} <span className="meta">{formatTime(r.reported_at)}</span> · <a href={href(`/tasks/${r.task_id}`)}>작업</a></li>)}</ul>}
          </section>
        </div>
      )}
    </>
  );
}
