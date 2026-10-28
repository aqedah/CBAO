/**
 * #/projects/:id — 프로젝트 개요 + 로드맵(읽기 전용). 로드맵 원본은 저장소 파일이며, 여기 보이는 것은 Runner 가 읽어 온 읽기 모델이다.
 */
import { href } from '../../app/router';
import { useStoreState } from '../../store/workspaceStore';
import { useThreads } from '../../store/threadStore';
import { Badge, formatAge, formatTime, useServerNow } from '../../shared/ui';
import { TASK_STATUS_LABEL } from '../../domain/types';
import { currentSection } from '../chat/ChatPage';

export function ProjectDetailPage({ projectId }: { projectId: string }) {
  const ws = useStoreState(s => s.workspace);
  const source = useStoreState(s => s.source);
  const { threads } = useThreads();
  const now = useServerNow();
  if (!ws) return <p className="empty">데이터가 없습니다.</p>;
  const p = ws.projects.find(x => x.project_id === projectId);
  if (!p) return <div className="card"><h1>프로젝트를 찾을 수 없습니다</h1><a href={href('/projects')}>프로젝트 목록</a></div>;
  const tasks = ws.tasks.filter(t => t.project_id === p.project_id && !['done', 'cancelled'].includes(t.status)).sort((a, b) => b.sequence - a.sequence);
  const myThreads = threads.filter(t => t.project_id === p.project_id).slice(0, 5);
  const rm = p.roadmap;
  const flow = `${p.work_branch || 'main'}${p.deploy_dir ? ` → 빌드 → ${p.deploy_branch || 'main'}` : ''}`;
  return (
    <>
      <div className="page-head"><h1>{p.name}</h1><span className="spacer" /><a className="btn primary" href={href('/chat', { project: p.project_id })}>이 프로젝트로 대화</a><a className="btn" href={href('/projects')}>목록</a></div>
      <div className="grid-2">
        <section className="card">
          <h2>개요</h2>
          <dl className="kv">
            <dt>목적</dt><dd>{p.purpose || '—'}</dd>
            <dt>저장소</dt><dd>{p.repo_reference ?? '없음'}</dd>
            <dt>가지 흐름</dt><dd>{flow}{p.build_command ? ` · 빌드 "${p.build_command}"` : ''}</dd>
            <dt>로드맵 원본</dt><dd>{p.roadmap_path ?? '연결 안 됨'}{rm?.source_commit ? <span className="meta"> · 읽은 버전 {rm.source_commit.slice(0, 10)} ({formatAge(rm.checked_at ?? null, now)})</span> : ''}</dd>
          </dl>
          <h3>최근 대화</h3>
          {source !== 'firebase' ? <p className="meta">Firebase 모드에서만 보입니다.</p> : myThreads.length === 0 ? <p className="empty">없음</p> : (
            <ul className="list">{myThreads.map(t => <li key={t.thread_id}><a href={href(`/chat/${t.thread_id}`)}>{t.title}</a> <span className="meta">{t.sync?.head_sha ? `버전 ${t.sync.head_sha.slice(0, 7)}` : '버전 없음'} · {formatAge(t.updated_at, now)}</span>{t.needs_owner && <Badge tone="attention">판단 필요</Badge>}</li>)}</ul>
          )}
          <h3>진행 작업</h3>
          {tasks.length === 0 ? <p className="empty">없음</p> : <ul className="list">{tasks.slice(0, 8).map(t => <li key={t.task_id}><a href={href(`/tasks/${t.task_id}`)}>{t.title}</a> <span className="meta">{TASK_STATUS_LABEL[t.status]}</span></li>)}</ul>}
        </section>
        <section className="card">
          <h2>로드맵 (읽기 전용)</h2>
          {!p.roadmap_path ? <p className="meta">아직 연결하지 않았습니다. <a href={href('/projects')}>프로젝트 수정</a>에서 저장소 안의 기존 문서 경로(예: docs/ROADMAP.md)를 적으면 심부름꾼이 읽어 옵니다. 새 계획을 만들어 덮어쓰지 않습니다.</p>
            : !rm ? <p className="meta">심부름꾼이 아직 읽지 않았습니다. 켜져 있으면 5분 안에 읽습니다.</p>
            : rm.parse_status === 'missing' ? <div className="notice error">{rm.error}</div>
            : (
              <>
                <p className="meta">{rm.parse_status === 'parsed' ? `${rm.done_count ?? 0}/${rm.item_count ?? 0} 항목에 완료 표시 · 현재 단계: ${currentSection(rm.sections)}` : '구조를 읽지 못해 원문만 보여 줍니다 (미확정 매핑)'} · 원본 {rm.path} · blob {rm.blob_sha?.slice(0, 10)} · 확인 {formatTime(rm.checked_at ?? null)}</p>
                {rm.parse_status === 'parsed' ? rm.sections.map((s, i) => (
                  <div key={i} style={{ marginLeft: Math.max(0, s.level - 1) * 10 }}>
                    <h3 style={{ fontSize: s.level <= 2 ? '1rem' : '.9rem' }}>{s.title}</h3>
                    {s.items.length > 0 && <ul className="list small">{s.items.map((it, j) => <li key={j}>{it.status === 'done' ? '☑' : it.status === 'todo' ? '☐' : '•'} {it.text}</li>)}</ul>}
                  </div>
                )) : <pre style={{ whiteSpace: 'pre-wrap', fontSize: '.85rem' }}>{rm.raw_head}</pre>}
                <p className="meta">완료 표시는 문서의 체크 표시를 그대로 읽은 것입니다. 커밋이 있다고 단계를 완료로 바꾸지 않습니다. 문서를 고치려면 저장소에서 고치세요 — 다음 읽기 때 반영됩니다.</p>
              </>
            )}
        </section>
      </div>
    </>
  );
}
