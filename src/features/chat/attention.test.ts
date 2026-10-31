import { describe, expect, it } from 'vitest';
import { attentionItems, type Thread } from '../../domain/chat';
import { memberBubbles } from '../pixel-office/bubbles';

const base: Thread = { thread_id: 't1', project_id: 'p', title: 'x', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z', member_id: 'm-claude', status: 'idle', pending: null, sessions: {}, messages: [], auto_review_member_id: null, last_publish: null, publish_count: 0 };

describe('내 차례(attention)·말풍선은 장부 상태에서만', () => {
  it('아무 일 없으면 비어 있다', () => { expect(attentionItems(base)).toEqual([]); expect(memberBubbles([base])).toEqual({}); });
  it('실행 중이면 내 차례가 아니다 (AI 차례)', () => {
    expect(attentionItems({ ...base, status: 'running', needs_owner: { reason: 'r', at: 'now' } })).toEqual([]);
  });
  it('판단 필요·질문·앱 미커밋·반영 실패가 각각 항목이 된다', () => {
    const t: Thread = { ...base, needs_owner: { reason: '한도', at: '2026-01-02T00:00:00Z' }, last_message: { kind: 'question', role: 'member', text: '언어는?', at: '2026-01-02T00:00:01Z' },
      sync: { branch: 'office/t1', head_sha: 'a'.repeat(40), dirty_paths: ['x.txt'], checked_at: '2026-01-02T00:00:02Z', remote: 'unchecked', worktree: 'C:/w' },
      last_publish: { status: 'failed', message: 'push 실패', at: '2026-01-02T00:00:03Z', commit: null } };
    expect(attentionItems(t).map(a => a.kind).sort()).toEqual(['app_dirty', 'decision', 'publish_failed', 'question']);
  });
  it('현재 버전 검토의 지적은 자동 검토가 꺼져 있을 때만 내 차례다', () => {
    const r = { review_id: 'r', reviewer_id: 'm-codex', target_sha: 'a'.repeat(40), verdict: 'changes_required' as const, findings: [{ id: 'F1', severity: 'low', location: '', claim: '', evidence: '', suggested_action: '', requires_human_judgment: false, status: 'open' as const }], checked: [], unverified: [], at: 'now', stale: false };
    const sync = { branch: 'b', head_sha: 'a'.repeat(40), dirty_paths: [], checked_at: 'now', remote: 'unchecked' as const, worktree: 'w' };
    expect(attentionItems({ ...base, reviews: [r], sync }).map(a => a.kind)).toEqual(['review']);
    expect(attentionItems({ ...base, reviews: [r], sync, auto_review_member_id: 'm-codex' })).toEqual([]);
    expect(attentionItems({ ...base, reviews: [{ ...r, target_sha: 'b'.repeat(40) }], sync })).toEqual([]);
  });
  it('말풍선: 실행 중엔 진행 한 줄, 멈춰서 기다리면 질문', () => {
    const running: Thread = { ...base, status: 'running', pending: { turn_id: 'x', member_id: 'm-codex', mode: 'review', message_id: null, requested_at: 'now' }, last_message: { kind: 'progress', role: 'member', text: 'Read: a.ts\nGrep: foo', at: 'now' } };
    expect(memberBubbles([running])).toEqual({ 'm-codex': { text: 'Grep: foo', tone: 'progress' } });
    expect(memberBubbles([{ ...base, needs_owner: { reason: '한도 초과', at: 'now' } }])['m-claude']).toEqual({ text: '한도 초과', tone: 'question' });
  });
});
