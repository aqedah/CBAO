/** 메시지 본문 Markdown 렌더링. 원본 텍스트는 그대로 저장되고 화면만 변환한다. 살균(DOMPurify) 후 표시. */
import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => {
    try {
      const raw = marked.parse(text ?? '', { async: false }) as string;
      return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true }, ADD_ATTR: ['target'] });
    } catch {
      return DOMPurify.sanitize((text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;'));
    }
  }, [text]);
  // unicode-bidi: plaintext — 히브리어가 섞인 문단만 그 방향을 따르고 전체 UI 는 그대로 (CHAT-04)
  return <div className="md" style={{ unicodeBidi: 'plaintext' }} dangerouslySetInnerHTML={{ __html: html }} />;
}
