# 픽셀 에셋 기록

## 출처·권리

- 모든 스프라이트는 `tools/pixel-art/*.mjs` 가 코드로 그린 원본이다 (`npm run atlas`). 외부 이미지·폰트·생성형 이미지를 사용하지 않았다.
- `docs/handoff/reference/cozy-office-concept.png` 는 분위기 참고로만 보았고, 잘라 쓰거나 배경으로 깔지 않았다.
- 라이선스: CC0-1.0 (이 저장소 소유). 공식 로고·브랜드 캐릭터 없음. 캐릭터는 의복·머리·소품으로만 구별한다.

## 산출물

| 파일 | 내용 |
|---|---|
| `public/pixel-office/atlas.png` | 1024×1024 RGBA, 105 프레임, 압축 24 KB (gzip 17 KB). 2px 여백 + 1px edge extrude |
| `public/pixel-office/atlas.json` | Pixi Spritesheet 형식. 프레임명 `{asset_id}/{clip}/{index}`, anchor 정규화 좌표, `meta.desk_avatar_offset` |
| `public/pixel-office/preview.png` | 검수용 미리보기 (책상+캐릭터 합성, 클립별 프레임) |

## 제작 상태 (office.assets.json 대비)

| asset_id | 상태 | 비고 |
|---|---|---|
| floor-wood | 완료 (2변형) | 32×16 다이아몬드, 결·경계선 |
| room-shell | 완료 (타일식 벽 패널로 대체) | `wall-nw/plain,window`, `wall-ne/plain,window` 32×96. 한 장 배경이 아니라 타일 단위 |
| desk-standard | 완료 | rear(뒤 수납장) / chair / front(책상·모니터·키보드·머그·노트) 분리. avatar_slot offset = (-7,-4) 측정값 |
| bookshelf, task-board, meeting-table, owner-desk, sofa, coffee-station, plant-large(2변형), rug, runner-console | 완료 | 문자·숫자·상태등 없음 |
| floor-lamp | 추가 제작 | 장면 JSON 에 `floor-lamp` 오브젝트(1,13) 추가 |
| avatar-gpt / claude / gemini / notebooklm / codex | 완료 | 64×80, anchor (0.5,0.9). idle 4 / typing 6 / reading 4 / waiting 2 / still 1 = 17 프레임 × 5 |
| light-overlay | 코드 처리 | PNG 대신 Pixi Graphics 정적 앰버 광량 (조명 레이어). 움직임 없음 |

## 남은 placeholder / 한계

- 에셋 로딩 실패 시에만 회색 대체 도형이 나온다 (정상 경로에는 placeholder 없음).
- 캐릭터는 south_east 한 방향, 앉은 자세만 있다 (자유 보행·4방향은 범위 밖).
- 픽셀 밀도는 통일했으나 비정수 배율(모바일 맞춤)에서는 완전한 픽셀 정렬을 보장하지 않는다.
- 소리 에셋 없음 (기본 음소거, 설정 토글은 있으나 재생할 소리가 없음).
- 아트 완성도는 '코드로 그린 1차 제작본'이다. 손으로 그린 정식 도트 에셋으로 교체하려면 같은 프레임명·anchor 로 아틀라스만 바꾸면 된다.
