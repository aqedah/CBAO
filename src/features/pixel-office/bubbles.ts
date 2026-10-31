/**
 * 픽셀 사무실 말풍선 — 대화방 장부에서만 만든다 (Pixel Agents·Roundtable 류의 "어깨 너머로 보기").
 * 실행 중: 마지막 진행 한 줄. 멈춰서 나를 기다림: 질문/판단. 실패: 오류. 그 외: 없음.
 */
import type { Thread } from '../../domain/chat';

export interface Bubble { text: string; tone: 'progress' | 'question' | 'error' }

export function memberBubbles(threads: Thread[]): Record<string, Bubble> {
  const out: Record<string, Bubble> = {};
  // 최근 갱신 순으로 들어온다고 가정하지 않고, 대화방마다 updated_at 이 큰 것을 우선한다
  const sorted = [...threads].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  for (const t of sorted) {
    const member = t.status !== 'idle' ? (t.pending?.member_id ?? t.member_id) : t.member_id;
    if (!member || out[member]) continue;
    const lm = t.last_message;
    if (t.status === 'running' && lm) out[member] = { text: oneLine(lm.text), tone: 'progress' };
    else if (t.status === 'idle' && t.needs_owner) out[member] = { text: oneLine(t.needs_owner.reason), tone: 'question' };
    else if (t.status === 'idle' && lm?.kind === 'question') out[member] = { text: oneLine(lm.text), tone: 'question' };
    else if (t.status === 'idle' && lm?.kind === 'error') out[member] = { text: oneLine(lm.text), tone: 'error' };
  }
  return out;
}
function oneLine(s: string): string {
  const lines = s.split('\n').map(x => x.trim()).filter(Boolean);
  return (lines[lines.length - 1] ?? '').slice(0, 60);
}
