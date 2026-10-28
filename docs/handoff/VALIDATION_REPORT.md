# 검증 결과 — 픽셀 사무실 개발 전달 묶음

설계 기준일: 2026-10-28. 이 보고서는 **이번 응답에서 생성한 파일과 기초 코드의 검사 결과**다. 기존 AI Office 앱 통합·배포 결과가 아니다.

## 실제 수행 결과

| 대상 | 실행 | 결과 |
|---|---|---|
| 상태 투영·연결 신선도·수동 보고 구별 | `npm test` | 단위 테스트 전체 31개 중 해당 사례 통과 |
| 종료와 결과 제출·업무 완료 구별 | 같은 단위 테스트 | 실행 성공을 결과 제출·업무 완료로 승격하지 않음 |
| snapshot 중복·역순·demo/live 경계 | 같은 단위 테스트 | 관련 사례 통과 |
| 등각 좌표·역변환·카메라·깊이 정렬 | 같은 단위 테스트 | 관련 사례 통과 |
| 단위 테스트 합계 | `npm test` | **31 통과 / 0 실패** |
| JSON Schema·참조·범위·의도적 거부 | `python tests/validate_contracts.py` | **19 통과 / 0 실패** |
| 기존 명세 보존 | SHA-256 비교 | 원본과 참고용 복사본 일치 |

실행 환경: 이 응답의 Linux 컨테이너, Node.js v22.16.0, Python 3.13.5. 브라우저나 사용자의 Windows PC에서 실행한 테스트가 아니다. 자세한 실행 출력은 `tests/node-test-results.txt`, `tests/contract-validation-results.json`에 있다.

기존 명세 SHA-256: `79ce8e8875aa6b687786d1c0d215fa647abb8a5873628984cdbce14d9debd79f`

## 검증하지 않은 것

React 화면, PixiJS 렌더러와 lifecycle, 최종 픽셀 스프라이트, 실제 AI/Runner 연결, 실제 업무 데이터, 브라우저별 화면·성능, Windows/Whale 환경, 기존 앱 회귀, GitHub push·배포는 이번 패키지에 포함된 완료 작업이 아니다.

`office.assets.json`에 명시한 제작용 스프라이트는 아직 없다. 참고 개념 이미지 1장만 포함되어 있다. `implementation.plan.json`의 구현 항목은 모두 planned이며, 실제 앱 인수 시험 26개는 `ACCEPTANCE_TESTS.md`의 계획이다.

## 코드의 역할

`starter/office-view-model.mjs`와 `starter/isometric.mjs`는 바로 실행할 수 있는 순수 함수 기초 코드다. 실제 UI와 인증된 저장소 어댑터를 붙이는 작업은 남아 있다. 테스트 통과는 여기서 검증한 계약과 동작에 한정된다.
