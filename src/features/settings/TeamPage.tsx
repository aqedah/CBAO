import { useState, type FormEvent } from 'react';
import { getStore, useStoreState } from '../../store/workspaceStore';
import { CommandError, newIdempotencyKey } from '../../store/commands';
import { EXEC_MODE_LABEL, type ExecutionMode } from '../../domain/types';
import { Badge } from '../../shared/ui';

/** S61 팀원과 자리 바인딩. 자리 seed 이름은 member_id 가 아니다. 명시적으로 연결한다. */
export function TeamPage() {
  const ws = useStoreState(s => s.workspace);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [mode, setMode] = useState<ExecutionMode>('external');
  const [tool, setTool] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!ws) return <p className="empty">데이터가 없습니다.</p>;

  const register = async (e: FormEvent) => {
    e.preventDefault(); setError(null);
    try { await getStore().command({ type: 'register_member', display_name: name, role_label: role, execution_mode: mode, tool_label: tool, idempotency_key: newIdempotencyKey() }); setName(''); setRole(''); setTool(''); }
    catch (err) { setError(err instanceof CommandError ? err.message : '등록 실패'); }
  };

  return (
    <>
      <div className="page-head"><h1>팀원·자리</h1></div>
      <div className="grid-2">
        <section className="card">
          <h2>팀원</h2>
          {ws.members.length === 0 ? <p className="empty">등록된 팀원이 없습니다.</p> : (
            <ul className="list">{ws.members.map(m => <li key={m.member_id}><strong>{m.display_name}</strong> <span className="meta">{m.member_id}</span> <Badge tone={m.execution_mode === 'managed' ? 'active' : 'muted'}>{EXEC_MODE_LABEL[m.execution_mode]}</Badge><div className="meta">{m.role_label} · {m.tool_label || '도구 미지정'} · 중지 요청 {m.capabilities.request_cancel ? '지원' : '미지원'}</div></li>)}</ul>
          )}
        </section>
        <section className="card">
          <h2>팀원 등록</h2>
          <p className="meta">관리형/관찰형 연결은 연결 시험을 통과한 서버 모드에서만 등록됩니다. 이름이 GPT/Claude 라는 이유로 계정이나 실행 능력이 증명되지 않습니다.</p>
          <form className="stack" onSubmit={register}>
            <label>이름<input value={name} onChange={e => setName(e.target.value)} required /></label>
            <label>역할<input value={role} onChange={e => setRole(e.target.value)} placeholder="예: 연구·설계·검수" /></label>
            <label>연결 방식
              <select value={mode} onChange={e => setMode(e.target.value as ExecutionMode)}>
                <option value="external">외부 작업 (수동 보고)</option>
                <option value="unconfigured">미연결</option>
                <option value="managed">관리형 실행 (서버 모드 필요)</option>
                <option value="observed">관찰형 연결 (서버 모드 필요)</option>
              </select>
            </label>
            <label>실제 도구/서비스<input value={tool} onChange={e => setTool(e.target.value)} placeholder="예: ChatGPT 웹, Claude Code CLI" /></label>
            {error && <div className="notice error" role="alert">{error}</div>}
            <button className="btn primary" type="submit">등록</button>
          </form>
        </section>
      </div>
    </>
  );
}
