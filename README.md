# AI Office (CBAO — Central Bible AI Office)

배포 주소: https://aqedah.github.io/CBAO/ (GitHub Pages, `main` 기준)

사용자 1인이 총괄하는 통합형 AI 사무실의 프론트엔드. 메인 대시보드(`#/office`)와, 같은 업무 데이터를 따뜻한 2.5D 픽셀 장면으로 보여주는 픽셀 사무실(`#/office/room`)을 제공한다.

- 명세: `docs/handoff/` (v1 원본 명세 + 픽셀 사무실 1.1 추가 명세)
- 구현 보고: `docs/IMPLEMENTATION_REPORT.md`
- 에셋 기록: `docs/ASSET_RECORD.md`
- 시험 결과: `docs/test-results/`

## 실행

```sh
npm install
npm run dev          # 개발 서버
npm run build        # 정적 빌드 (dist/, base=/CBAO/) — main 푸시 시 GitHub Actions 가 Pages 로 배포
npm run preview
npm test             # 단위 시험 (vitest)
npm run e2e          # 브라우저 인수 시험 (빌드 후; Playwright + Chromium 필요)
npm run atlas        # 픽셀 아틀라스 재생성 (public/pixel-office/)
```

## 데이터 소스 (설정 → 연결)

| 소스 | 내용 | 실제 Runner 근거 |
|---|---|---|
| 서버 연결 | `VITE_AI_OFFICE_API` 로 지정한 기존 서버 API. **이 저장소에는 서버가 없어 미검증** | 서버가 제공 |
| 로컬 (서버 미연결) | 이 브라우저에만 저장. 프로젝트·팀원 등록, 지시, 외부 작업 **직접 보고**, 승인 | 없음 — 관리형 실행 불가 |
| 데모 | fixture 가짜 데이터. 모든 화면에 보라색 데모 배지 | 없음 (가짜) |

`#/office/room` 은 실행 엔진이 아니라 읽기 전용 표현 계층이다. 클릭·캐릭터 동작·애니메이션은 작업 완료·승인·실행을 발생시키지 않는다.
