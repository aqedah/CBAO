/**
 * '내 차례' 계산과 알림. 대화방 장부 상태에서만 계산한다 (Codex 앱·Devin 류의 "돌아와서 볼 것" 목록과 같은 역할).
 * 브라우저 알림은 사용자가 켠 경우에만, 새로 생긴 항목에 대해서만 한 번 보낸다.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { Thread } from '../../domain/chat';
import { attentionItems, type AttentionItem } from '../../domain/chat';
import { href } from '../../app/router';

export function useAttention(threads: Thread[]): AttentionItem[] {
  return useMemo(() => threads.flatMap(attentionItems).sort((a, b) => (b.at > a.at ? 1 : -1)), [threads]);
}

const KEY = 'ai-office.notify';
export function notifyEnabled(): boolean { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } }
export async function setNotifyEnabled(on: boolean): Promise<boolean> {
  if (on && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
    const p = await Notification.requestPermission();
    if (p !== 'granted') return false;
  }
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* ignore */ }
  return on;
}

/** 새 '내 차례' 항목이 생기면 브라우저 알림 + 탭 제목 배지. 첫 로드의 기존 항목은 알리지 않는다. */
export function useAttentionNotifications(items: AttentionItem[], threads: Thread[], loaded: boolean) {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\)\s*/, '');
    document.title = items.length ? `(${items.length}) ${base}` : base;
  }, [items.length]);
  useEffect(() => {
    if (!loaded) return;
    const keys = new Set(items.map(i => `${i.thread_id}:${i.kind}:${i.at}`));
    if (seen.current === null) { seen.current = keys; return; }
    const fresh = items.filter(i => !seen.current!.has(`${i.thread_id}:${i.kind}:${i.at}`));
    seen.current = keys;
    if (!fresh.length || !notifyEnabled() || typeof Notification === 'undefined' || Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
    for (const i of fresh.slice(0, 3)) {
      const t = threads.find(x => x.thread_id === i.thread_id);
      try {
        const n = new Notification(t?.title ?? '바이브코딩인력사무소', { body: i.label.slice(0, 120), tag: `${i.thread_id}:${i.kind}` });
        n.onclick = () => { window.focus(); location.hash = href(`/chat/${i.thread_id}`); };
      } catch { /* 알림 불가 환경 */ }
    }
  }, [items, threads, loaded]);
}
