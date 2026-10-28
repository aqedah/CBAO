// 캐릭터 5명. 같은 골격, 다른 의복·머리·소품. 64×80 프레임, anchor (32,72)=의자 타일 접지점.
// 모든 프레임에서 baseline(접지점)과 몸통 위치를 동일하게 유지한다. 로고를 머리로 쓰지 않는다.
import { Canvas, shade } from './canvas.mjs';
import { P } from './palette.mjs';

export const CHARACTERS = {
  gpt: { cloth: P.sage, clothDark: P.sageDark, hair: P.hairBrown, hairStyle: 'side', prop: 'book', glasses: true, skin: P.skin },
  claude: { cloth: P.terracotta, clothDark: P.terracottaDark, hair: P.hairAuburn, hairStyle: 'bob', prop: 'keyboard', glasses: false, skin: P.skin },
  gemini: { cloth: P.blue, clothDark: P.blueDark, hair: P.hairBlack, hairStyle: 'short', prop: 'board', glasses: false, skin: '#e6b995' },
  notebooklm: { cloth: P.cream, clothDark: P.creamShade, hair: P.hairAsh, hairStyle: 'bun', prop: 'cards', glasses: true, skin: '#f4d3b4' },
  codex: { cloth: P.slate, clothDark: P.slateDark, hair: P.hairDark, hairStyle: 'cap', prop: 'checklist', glasses: false, skin: '#dcb08c' },
};

export const CLIPS = { idle: 4, typing: 6, reading: 4, waiting: 2, still: 1 };

/**
 * 동작 매개변수. 좌표는 프레임 픽셀.
 * bodyDy: 숨쉬기(몸통 상하 1px), handL/handR dy: 손 높이, headDx: 고개 돌림, eyes: 'open'|'closed'|'down', page: 책장 넘김
 */
function pose(clip, i) {
  switch (clip) {
    case 'idle': return { bodyDy: [0, -1, 0, 0][i], hands: [0, 0], eyes: i === 3 ? 'closed' : 'open', headDx: 0, page: 0, mode: 'rest' };
    case 'typing': return { bodyDy: 0, hands: [[0, -1], [-1, 0], [0, 1], [1, 0], [-1, -1], [0, 0]][i], eyes: 'down', headDx: 0, page: 0, mode: 'type' };
    case 'reading': return { bodyDy: [0, 0, -1, 0][i], hands: [0, 0], eyes: 'down', headDx: 0, page: i >= 2 ? 1 : 0, mode: 'read' };
    case 'waiting': return { bodyDy: 0, hands: [0, 0], eyes: 'open', headDx: i === 0 ? -1 : 1, page: 0, mode: 'rest' };
    default: return { bodyDy: 0, hands: [0, 0], eyes: 'open', headDx: 0, page: 0, mode: 'rest' };
  }
}

export function drawAvatar(key, clip, frame) {
  const ch = CHARACTERS[key];
  const c = new Canvas(64, 80);
  const { bodyDy, hands, eyes, headDx, page, mode } = pose(clip, frame);
  const cx = 32;              // 중심 x
  const hipY = 58;            // 앉은 엉덩이 (의자 좌판 위)
  const by = bodyDy;
  const L = P.line;

  // --- 다리 (허벅지: 앞으로 나옴, 책상 앞판에 가려짐)
  const pants = shade(ch.clothDark, 0.8);
  c.rect(cx - 11, hipY - 2, 9, 11, pants); c.rect(cx + 2, hipY - 2, 9, 11, pants);
  c.rect(cx - 11, hipY + 8, 9, 2, shade(pants, 0.7)); c.rect(cx + 2, hipY + 8, 9, 2, shade(pants, 0.7));
  c.outline([[cx - 11, hipY - 2], [cx - 3, hipY - 2], [cx - 3, hipY + 9], [cx - 11, hipY + 9]], L);
  c.outline([[cx + 2, hipY - 2], [cx + 10, hipY - 2], [cx + 10, hipY + 9], [cx + 2, hipY + 9]], L);

  // --- 몸통 (어깨 넓고 아래로 약간 좁아짐)
  const top = 34 + by, bot = hipY;
  c.poly([[cx - 13, top + 2], [cx + 13, top + 2], [cx + 12, bot], [cx - 12, bot]], ch.cloth);
  // 오른쪽(광원 반대) 음영
  c.poly([[cx + 5, top + 2], [cx + 13, top + 2], [cx + 12, bot], [cx + 5, bot]], ch.clothDark, 110);
  c.outline([[cx - 13, top + 2], [cx + 13, top + 2], [cx + 12, bot], [cx - 12, bot]], L);
  // 의복 디테일
  if (key === 'claude') { // 가디건 앞섶
    c.vline(cx, top + 3, bot - 1, ch.clothDark); c.vline(cx - 1, top + 3, bot - 1, shade(ch.cloth, 1.1));
    c.rect(cx - 6, top + 2, 12, 3, P.cream);
  } else if (key === 'gpt') { // 니트 목선
    c.rect(cx - 5, top + 2, 10, 2, shade(ch.cloth, 1.15));
    c.hline(cx - 10, cx + 10, bot - 3, ch.clothDark);
  } else if (key === 'notebooklm') { // 조끼 + 셔츠
    c.poly([[cx - 5, top + 2], [cx + 5, top + 2], [cx + 2, top + 9], [cx - 2, top + 9]], '#ffffff');
    c.vline(cx, top + 3, bot - 1, ch.clothDark);
    c.set(cx, top + 10, L); c.set(cx, top + 14, L);
  } else if (key === 'codex') { // 작업복 멜빵
    c.vline(cx - 6, top + 2, bot - 1, shade(ch.cloth, 1.2)); c.vline(cx + 6, top + 2, bot - 1, shade(ch.cloth, 1.2));
    c.rect(cx - 9, top + 9, 18, 1, ch.clothDark);
  } else if (key === 'gemini') { // 셔츠 칼라
    c.poly([[cx - 7, top + 2], [cx, top + 8], [cx + 7, top + 2]], P.cream);
  }

  // --- 팔 (어깨에서 앞으로, 손은 책상 위)
  const [hdx, hdy] = hands;
  const readLift = mode === 'read' ? -6 : 0;
  const handLx = cx - 10 + (mode === 'read' ? 3 : 0) + hdx;
  const handLy = 51 + readLift + hdy;
  const handRx = cx + 10 - (mode === 'read' ? 3 : 0) - hdx;
  const handRy = 51 + readLift - hdy; // 반대 손은 반대 방향으로 → 타이핑 교차 동작
  const sleeve = ch.cloth, sleeveDark = ch.clothDark;
  // 상완 (어깨 → 앞)
  c.poly([[cx - 14, top + 4], [cx - 9, top + 4], [handLx + 2, handLy - 2], [handLx - 3, handLy - 2]], sleeve);
  c.poly([[cx + 9, top + 4], [cx + 14, top + 4], [handRx + 3, handRy - 2], [handRx - 2, handRy - 2]], sleeveDark);
  c.line(cx - 14, top + 4, handLx - 3, handLy - 2, L); c.line(cx + 14, top + 4, handRx + 3, handRy - 2, L);
  // 손
  c.rect(handLx - 3, handLy - 2, 5, 4, ch.skin); c.rect(handRx - 2, handRy - 2, 5, 4, ch.skin);
  c.outline([[handLx - 3, handLy - 2], [handLx + 1, handLy - 2], [handLx + 1, handLy + 1], [handLx - 3, handLy + 1]], L);
  c.outline([[handRx - 2, handRy - 2], [handRx + 2, handRy - 2], [handRx + 2, handRy + 1], [handRx - 2, handRy + 1]], L);

  // --- 소품
  if (mode === 'read' || (ch.prop === 'book' && mode === 'rest' && clip !== 'waiting')) {
    // 펼친 책 (양손 사이)
    const bx = cx - 9, byy = handLy - 5;
    c.poly([[bx, byy], [bx + 9, byy + 3], [bx + 9, byy + 11], [bx, byy + 8]], page ? P.paper : P.cream);
    c.poly([[bx + 9, byy + 3], [bx + 18, byy], [bx + 18, byy + 8], [bx + 9, byy + 11]], page ? P.cream : P.paper);
    c.outline([[bx, byy], [bx + 9, byy + 3], [bx + 18, byy], [bx + 18, byy + 8], [bx + 9, byy + 11], [bx, byy + 8]], L);
    c.line(bx + 9, byy + 3, bx + 9, byy + 11, L);
  } else if (ch.prop === 'cards' && mode !== 'type') {
    c.rect(handLx + 2, handLy - 6, 6, 4, P.paper); c.outline([[handLx + 2, handLy - 6], [handLx + 7, handLy - 6], [handLx + 7, handLy - 3], [handLx + 2, handLy - 3]], L);
    c.rect(handLx + 4, handLy - 8, 6, 4, P.stickyY); c.outline([[handLx + 4, handLy - 8], [handLx + 9, handLy - 8], [handLx + 9, handLy - 5], [handLx + 4, handLy - 5]], L);
  } else if (ch.prop === 'checklist' && mode !== 'type') {
    c.rect(handRx - 8, handRy - 7, 7, 8, P.paper); c.outline([[handRx - 8, handRy - 7], [handRx - 2, handRy - 7], [handRx - 2, handRy], [handRx - 8, handRy]], L);
    c.set(handRx - 6, handRy - 5, P.sage); c.set(handRx - 6, handRy - 3, P.sage);
  } else if (ch.prop === 'board' && mode !== 'type') {
    // 작은 이미지 보드 (색 블록만)
    c.rect(handRx - 9, handRy - 9, 9, 7, P.cream); c.outline([[handRx - 9, handRy - 9], [handRx - 1, handRy - 9], [handRx - 1, handRy - 3], [handRx - 9, handRy - 3]], L);
    c.rect(handRx - 8, handRy - 8, 3, 2, P.blue); c.rect(handRx - 4, handRy - 8, 3, 2, P.terracotta); c.rect(handRx - 8, handRy - 5, 7, 1, P.sage);
  }

  // --- 목
  c.rect(cx - 3, top - 2, 6, 4, ch.skin);
  // --- 머리
  const hx = cx + headDx, hy = 12 + by; // 머리 상단
  const HEAD = [[hx - 8, hy + 2], [hx + 8, hy + 2], [hx + 10, hy + 6], [hx + 10, hy + 17], [hx + 6, hy + 22], [hx - 6, hy + 22], [hx - 10, hy + 17], [hx - 10, hy + 6]];
  c.poly(HEAD, ch.skin);
  c.poly([[hx + 5, hy + 6], [hx + 10, hy + 6], [hx + 10, hy + 17], [hx + 6, hy + 22], [hx + 5, hy + 22]], shade(ch.skin, 0.9));
  c.outline(HEAD, L);
  // 머리카락
  const H = ch.hair, Hd = shade(ch.hair, 0.75);
  switch (ch.hairStyle) {
    case 'side': // 옆 가르마
      c.poly([[hx - 10, hy + 8], [hx - 10, hy + 3], [hx - 7, hy - 1], [hx + 7, hy - 1], [hx + 10, hy + 3], [hx + 10, hy + 7], [hx + 3, hy + 5], [hx - 5, hy + 8]], H);
      c.rect(hx + 8, hy + 6, 3, 6, H); c.outline([[hx - 10, hy + 8], [hx - 10, hy + 3], [hx - 7, hy - 1], [hx + 7, hy - 1], [hx + 10, hy + 3]], L); break;
    case 'bob': // 단발
      c.poly([[hx - 11, hy + 16], [hx - 11, hy + 3], [hx - 7, hy - 1], [hx + 7, hy - 1], [hx + 11, hy + 3], [hx + 11, hy + 16], [hx + 8, hy + 16], [hx + 8, hy + 7], [hx - 8, hy + 7], [hx - 8, hy + 16]], H);
      c.rect(hx - 11, hy + 15, 4, 1, Hd); c.rect(hx + 8, hy + 15, 4, 1, Hd);
      c.outline([[hx - 11, hy + 16], [hx - 11, hy + 3], [hx - 7, hy - 1], [hx + 7, hy - 1], [hx + 11, hy + 3], [hx + 11, hy + 16]], L); break;
    case 'short':
      c.poly([[hx - 10, hy + 7], [hx - 10, hy + 2], [hx - 6, hy - 1], [hx + 6, hy - 1], [hx + 10, hy + 2], [hx + 10, hy + 7], [hx + 6, hy + 5], [hx - 6, hy + 5]], H);
      c.rect(hx + 8, hy + 6, 3, 4, H); c.outline([[hx - 10, hy + 7], [hx - 10, hy + 2], [hx - 6, hy - 1], [hx + 6, hy - 1], [hx + 10, hy + 2], [hx + 10, hy + 7]], L); break;
    case 'bun':
      c.poly([[hx - 10, hy + 7], [hx - 10, hy + 2], [hx - 6, hy - 1], [hx + 6, hy - 1], [hx + 10, hy + 2], [hx + 10, hy + 7], [hx + 5, hy + 5], [hx - 5, hy + 5]], H);
      c.outline([[hx - 10, hy + 7], [hx - 10, hy + 2], [hx - 6, hy - 1], [hx + 6, hy - 1], [hx + 10, hy + 2], [hx + 10, hy + 7]], L);
      c.ellipse(hx + 1, hy - 2, 5, 3, H); c.ellipse(hx, hy - 2, 2.5, 1.5, Hd); break;
    case 'cap': // 작업 모자
      c.poly([[hx - 11, hy + 7], [hx - 11, hy + 2], [hx - 6, hy - 2], [hx + 6, hy - 2], [hx + 11, hy + 2], [hx + 11, hy + 7]], ch.clothDark);
      c.rect(hx - 11, hy + 6, 22, 2, shade(ch.clothDark, 0.8)); c.rect(hx - 2, hy + 7, 15, 2, shade(ch.clothDark, 0.8));
      c.outline([[hx - 11, hy + 7], [hx - 11, hy + 2], [hx - 6, hy - 2], [hx + 6, hy - 2], [hx + 11, hy + 2], [hx + 11, hy + 7]], L);
      c.rect(hx - 10, hy + 8, 2, 4, H); c.rect(hx + 8, hy + 8, 3, 4, H); break;
  }
  // 눈
  const ey = hy + 12 + (eyes === 'down' ? 1 : 0);
  const ex1 = hx - 5 + headDx, ex2 = hx + 3 + headDx;
  if (eyes === 'closed') { c.hline(ex1, ex1 + 1, ey, L); c.hline(ex2, ex2 + 1, ey, L); }
  else { c.rect(ex1, ey - 1, 2, 2, L); c.rect(ex2, ey - 1, 2, 2, L); }
  // 입
  c.hline(hx - 1, hx + 1, hy + 18, shade(ch.skin, 0.7));
  // 안경
  if (ch.glasses) {
    c.outline([[ex1 - 1, ey - 2], [ex1 + 2, ey - 2], [ex1 + 2, ey + 1], [ex1 - 1, ey + 1]], P.metalDark);
    c.outline([[ex2 - 1, ey - 2], [ex2 + 2, ey - 2], [ex2 + 2, ey + 1], [ex2 - 1, ey + 1]], P.metalDark);
    c.set(ex1 + 3, ey - 1, P.metalDark); c.set(ex1 + 4, ey - 1, P.metalDark);
  }
  // 볼 (따뜻한 인상)
  c.rect(hx - 8, hy + 15, 2, 1, '#e7a98f', 140); c.rect(hx + 6, hy + 15, 2, 1, '#e7a98f', 140);
  return c;
}
