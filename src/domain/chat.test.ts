import { describe, expect, it } from 'vitest';
import { reviewIsCurrent, type Review } from './chat';
import { currentSection } from '../features/chat/ChatPage';

const base: Review = { review_id: 'r1', reviewer_id: 'm', target_sha: 'a'.repeat(40), verdict: 'pass', findings: [], checked: [], unverified: [], at: '2026-01-01T00:00:00Z', stale: false };

describe('V2 검토·로드맵 표시 규칙', () => {
  it('검토는 같은 SHA 일 때만 현재 버전 검토다 (REVIEW-03/04)', () => {
    expect(reviewIsCurrent(base, 'a'.repeat(40))).toBe(true);
    expect(reviewIsCurrent(base, 'b'.repeat(40))).toBe(false);
    expect(reviewIsCurrent({ ...base, stale: true }, 'a'.repeat(40))).toBe(false);
    expect(reviewIsCurrent(base, null)).toBe(false);
  });
  it('현재 단계는 첫 미완료 항목이 있는 절 (ROADMAP-04: 커밋만으로 완료 처리하지 않음)', () => {
    expect(currentSection([{ title: '1단계', items: [{ status: 'done' }] }, { title: '2단계', items: [{ status: 'todo' }] }])).toBe('2단계');
    expect(currentSection([{ title: '1단계', items: [{ status: 'done' }] }])).toBe('모두 완료 표시');
    expect(currentSection([])).toBe('—');
  });
});
