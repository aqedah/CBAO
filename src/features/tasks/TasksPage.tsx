import { href } from '../../app/router';
import { useStoreState } from '../../store/workspaceStore';
import { Badge, formatTime } from '../../shared/ui';
import { TASK_STATUS_LABEL } from '../../domain/types';
import { useProjectFilter } from '../office-shared/useOfficeSnapshot';

export function TasksPage() {
  const ws = useStoreState(s => s.workspace);
  const project = useProjectFilter();
  if (!ws) return <p className="empty">데이터가 없습니다.</p>;
  const tasks = ws.tasks.filter(t => !project || t.project_id === project).sort((a, b) => b.sequence - a.sequence);
  return (
    <>
      <div className="page-head"><h1>작업함</h1><span className="spacer" /><a className="btn primary" href={href('/tasks/new', { project })}>+ 새 지시</a></div>
      {tasks.length === 0 ? <p className="empty">작업이 없습니다.</p> : (
        <table>
          <thead><tr><th>ID</th><th>제목</th><th>프로젝트</th><th>담당</th><th>상태</th><th>갱신</th></tr></thead>
          <tbody>
            {tasks.map(t => (
              <tr key={t.task_id}>
                <td className="meta">{t.task_id}</td>
                <td><a href={href(`/tasks/${t.task_id}`)}>{t.title}</a></td>
                <td>{t.project_id}</td>
                <td>{ws.members.find(m => m.member_id === t.assignee_member_id)?.display_name ?? '미배정'}</td>
                <td><Badge tone={t.status === 'awaiting_owner' || t.status === 'blocked' ? 'attention' : t.status === 'active' ? 'active' : t.status === 'done' ? 'active' : 'muted'}>{TASK_STATUS_LABEL[t.status]}</Badge></td>
                <td className="meta">{formatTime(t.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
