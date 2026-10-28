# AI Office — 따뜻한 픽셀 사무실 개발 전달 묶음

작성일: 2026-10-28 · 추가 명세 버전: 1.1.0 · 언어: 한국어

## 전달 방법

이 폴더 전체를 기존 AI Office 저장소에 참고 자료로 제공하고 `CLAUDE_START_HERE.md`를 먼저 읽도록 요청한다. 저장소 루트에 무작정 덮어쓰지 말고, 실제 앱 구조를 확인한 뒤 필요한 내용을 통합한다. 기존 v1 명세는 `reference/AI_OFFICE_V1_SPEC.original.md`에 원본 그대로 포함되어 있다.

**목표:** 메인 업무 대시보드를 보존하고, 같은 업무 데이터를 읽는 따뜻한 픽셀 사무실 보기를 추가한다. 사무실은 실행 엔진이 아니라 업무를 공간으로 보여주는 화면이다.

**시각 구현 기준:** 고정 등각 시점의 2.5D 픽셀아트. 입체적으로 보이는 공간이지만, 카메라를 자유롭게 회전하는 실제 3D 모델은 이번 기본 구현에 포함하지 않는다. 그 요구가 추가되면 별도 설계 결정을 남긴다.

## 중요한 파일

| 파일 | 용도 |
|---|---|
| `CLAUDE_START_HERE.md` | 개발자에게 그대로 전달하는 지시서 |
| `PIXEL_OFFICE_SPEC.md` | 화면, 상호작용, 상태, 성능, 접근성, 개발 순서 |
| `SPEC_DELTA.md` | 기존 명세와 충돌하는 조항의 명시적 변경 |
| `ART_ASSET_GUIDE.md` | 가구·캐릭터·조명 에셋 제작 및 검수 기준 |
| `INTEGRATION_CONTRACT.md` | 기존 DB·Runner·React 화면과 연결하는 계약 |
| `office.scene.json` | 좌표, 자리, 가구, 레이어, 카메라, 테마 |
| `office.assets.json` | 제작할 에셋 목록. 실제 스프라이트가 있다고 주장하지 않음 |
| `office.visual-states.json` | 상태별 문구·포즈·동작·색상 규칙 |
| `implementation.plan.json` | 개발 작업 순서와 완료 조건 |
| `contracts/*.schema.json` | 장면·화면용 snapshot의 JSON Schema |
| `examples/office.snapshot.demo.json` | 명시적으로 구분한 데모 데이터 |
| `starter/*.mjs` | 실행 가능한 읽기 전용 상태 투영·좌표 변환 기초 코드 |
| `tests/` | 실제 실행한 단위 검사와 JSON 검증 결과 |
| `reference/cozy-office-concept.png` | 대화에서 생성한 분위기 참고 이미지 |
| `VALIDATION_REPORT.md` | 이번 패키지에서 실제로 검증한 범위와 미검증 범위 |

## 포함 범위와 미포함 범위

포함: 개발 명세, 좌표 데이터, 상태 계약, 에셋 제작 지침, 기초 코드, 단위 테스트, 원본 참고 이미지.

미포함: 완성된 React 화면, PixiJS 렌더러, 제작 완료 스프라이트, 실제 AI 실행 연결, 사용자의 PC 연결, GitHub 수정·배포. 참조 이미지가 제작용 에셋 아틀라스인 것은 아니다.

## 기초 코드 검사

Node.js 20 이상에서 별도 패키지 설치 없이:

```sh
npm test
```

Python JSON 검증은 별도 선택 사항이다. `jsonschema`가 설치된 환경에서:

```sh
python tests/validate_contracts.py
```

`package.json`은 이 전달 묶음의 단위 검사용이며 기존 앱의 package.json을 교체하는 파일이 아니다. PixiJS 버전은 기존 앱 호환성을 확인해 8.x의 검증된 정확한 버전을 lockfile로 고정한다. 이 묶음은 PixiJS 런타임 설치를 수행하지 않았다.
