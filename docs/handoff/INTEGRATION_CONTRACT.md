# 기존 AI Office와의 연결 계약

## 1. 한 줄 구조

```text
기존 인증·권한·업무 DB / Runner 이벤트
           ↓ 기존 검증·재연결·중복 제거
      기존 Workspace Store
           ├─ 기존 대시보드
           └─ Office View Adapter → 픽셀 장면 + DOM 명패 + 상세 패널
```

픽셀 장면은 기존 서버 API를 직접 감시하거나 CLI 원문을 해석하지 않는다. 상태를 받아 표현하며 명령은 기존 명령 핸들러에 위임한다. 렌더러의 animation frame에서 DB를 갱신하지 않는다.

## 2. 권장 파일 경계

아래는 권장 구조이며 실제 저장소를 읽은 뒤 맞춘다. 이 경로들이 현재 저장소에 존재한다고 가정하지 않는다.

```text
src/features/pixel-office/
  PixelOfficePage.tsx          # 상단 전환, 접근성 목록, 오류 경계
  OfficeCanvas.tsx             # Pixi lifecycle, camera, load errors
  MemberNameplate.tsx          # 이름·작업·출처·시각을 DOM으로
  MemberDrawer.tsx             # 기존 상세/새 지시/결과 등록 연결
  OfficeAccessibleList.tsx     # 모든 주요 동작의 DOM 대안
  officeViewAdapter.ts        # 기존 도메인 → 읽기 전용 모델
  useOfficeSnapshot.ts        # 기존 스토어 selector, 중복 구독 금지
  renderer/
    createOfficeScene.ts
    updateMembers.ts
    projectCoordinates.ts
    assets.ts
  config/
    office.scene.json
    office.assets.json
    office.visual-states.json
```

Canvas component를 업무 이벤트마다 파괴·재생성하지 않는다. scene 객체를 안정적으로 보존하고 변경된 멤버의 시각 속성만 갱신한다. React가 매 프레임 캐릭터 좌표를 setState하도록 하지 않는다. DOM 명패의 카메라 좌표는 장면 변환과 동일한 값을 사용한다.

## 3. 읽기 모델

`contracts/office-snapshot.schema.json`을 검증한 객체를 화면에 전달한다. 예시는 `examples/office.snapshot.demo.json`이다.

| 필드 | 생성 주체/의미 |
|---|---|
| schema_version | 이 화면 계약의 버전. 기존 Runner 계약과 별개 |
| is_demo | 데이터 공간 경계. 실제 화면에 demo를 기본 주입하지 않음 |
| workspace_id | 인증 후 접근 가능한 기존 workspace |
| snapshot_sequence | 권한 있는 read model의 단조 증가 revision |
| captured_at | snapshot의 기준 서버 시각 |
| members | 기존 실제 팀원 ID에 대한 투영 |
| member.execution_mode | managed / observed / external / unconfigured |
| member.connection_state | 기존 서버에서 확인한 연결 상태 |
| member.last_heartbeat_at | 실제 연결 heartbeat. 수동 작업은 null |
| member.task | 현재 대표 업무. 기존 상태 enum 유지 |
| member.run | 현재 실행. 기존 상태 enum 유지 |
| run.last_confirmed_at | 실행 프로세스의 실제 마지막 생존/종료 확인 |
| run.evidence_source | runner_observed / tool_reported / server_derived |
| external_report | 사용자가 보고한 외부 작업 상태와 시각 |
| capabilities | 연결 시험과 서버 권한이 허용하는 행동 |

`snapshot_sequence`를 개별 run의 sequence나 클라이언트 시각에서 만들어서는 안 된다. 기존 store에 전역 revision이 있으면 그대로 사용한다. 없다면 **기존 cursor 규칙으로 검증·병합된 store commit 이후** 전용 view revision을 부여한다. 역순 네트워크 응답을 먼저 받아 revision만 올리는 방식은 금지한다. 서버 재시작으로 revision 범위가 초기화되면 재바인딩/전체 snapshot 수신을 통해 화면 상태를 명시적으로 초기화한다.

기존 앱에 충분한 selector가 있으면 새 endpoint는 만들지 않는다. 집계 endpoint가 필요한 경우에도 read-only이며 기존 권한을 적용한다. 픽셀 화면만을 위한 별도 tasks/runs/approvals 테이블을 만들지 않는다.

## 4. 표시 상태 계산

`starter/office-view-model.mjs`는 실행 가능한 기본 구현이다. UI 프로젝트의 TypeScript 타입으로 포장하거나 변환할 수 있다. 비밀키, 네트워크 요청, 자동 실행, 타이머를 포함하지 않는다.

```js
const view = deriveMemberView(member, {
  nowMs: serverCalibratedNow,
  snapshotCapturedAt: snapshot.captured_at,
  reducedMotion,
  hidden: document.hidden || !isRoomVisible,
  motionEnabled
});
```

`view.state`는 표현용이며 `task.status`에 저장하지 않는다. `canRequestCancel`은 버튼을 제시할 수 있다는 뜻이지 요청이 전달되었거나 프로세스가 종료되었다는 뜻이 아니다. `run.succeeded`는 실행 종료이며 산출물 제출까지 증명하지 않는다. 산출물은 별도 artifact 기록으로 확인하고, 사용자 승인 후의 task.done과도 구분한다.

시각 함수가 heartbeat 지연을 계산해도 서버의 실행 상태를 failed/cancelled로 수정하지 않는다. 실제 프로세스 관찰이 구현되지 않았다면 `runner_observed`로 값을 꾸며 넣지 않는다. 브라우저 타이머의 증가도 서버의 확인 시각을 갱신하지 않는다.

## 5. 자리 바인딩과 역할

`office.scene.json`의 seed_key를 실제 `member_id`와 설정 단계에서 연결한다. 표시 이름 문자열이 GPT/Claude라는 이유만으로 기존 계정·세션을 연결했다고 판단하지 않는다. 이름이 같은 멤버도 ID로 구분한다.

미연결 자리는 캐릭터의 정적 외형과 '미연결'을 보이고 설정으로 안내한다. 실제 팀원 하나를 Gemini와 NotebookLM의 두 독립 팀원으로 자동 복제하지 않는다. 실제 데이터에 두 역할이 없으면 한 자리는 비워두거나 명시적 역할 등록을 기다린다.

실행 수와 팀원 수는 독립이다. 하나의 PC에서 한 실행만 허용되면 다른 캐릭터는 배정 대기일 수 있다. 이 정책을 사무실 그림 때문에 변경하지 않는다.

## 6. 클릭 연결과 명령

Canvas action enum은 기존 React callback으로만 연결한다. 예:

```text
seat click          → selectMember(memberId)
new instruction     → navigateToExistingTaskForm({projectId, assigneeId})
task open           → existing task detail route
owner desk          → existing approvals route
cancel request      → existing confirmation → authorized command API
external result     → existing external-report form
```

기존 명령의 idempotency key, revision 검사, 권한 검사를 유지한다. JSON에 셸 명령이나 임의 API 주소를 넣어 실행시키지 않는다. 캐릭터를 테이블로 옮기는 효과를 만들더라도 인계 이벤트 수신 이후의 장식일 뿐이다.

## 7. PixiJS lifecycle

PixiJS v8의 Application은 생성 후 비동기 init을 거친다.[S01] React effect는 외부 시스템과 동기화·정리를 수행하도록 구성한다.[S06]

- init 전 unmount됨: 취소 플래그 기록. init 완료 후 결과를 붙이지 않고 정리.
- init 성공: canvas 연결, 필요한 이벤트·ResizeObserver·ticker 설치.
- 상태 변경: 기존 장면 객체에 읽기 모델 반영. renderer 재생성 금지.
- unmount: 모든 핸들러·observer·ticker·scene resource 정리.
- 공유 에셋: 소유권/refcount 정책을 정하고 다른 화면이 사용하는 전역 texture를 무작정 destroy하지 않음.
- 실패: DOM 팀원 목록과 기존 업무 행동 유지. 실제 오류와 다시 시도 방법 표시.

정확한 Pixi API는 실제 설치 버전으로 확인하고 lockfile을 남긴다. 이 전달 묶음은 renderer의 init/destroy 동작을 브라우저에서 시험한 결과물이 아니다.

## 8. 실제 연결 검수

승인된 폐기용 샘플 작업으로 관리형 run 하나를 관찰한다. 시작, 검사, 성공/실패, 결과 검토, 연결 끊김을 기존 대시보드와 비교한다. 원격 제어가 지원되지 않는 관찰형 연결에는 중지 버튼을 만들지 않는다.

외부 작업 하나는 사용자가 시작/완료를 직접 보고한다. 캐릭터와 명패가 '직접 보고'임을 유지하고 자동 연결로 승격되지 않아야 한다. 실제 연결을 하지 못한 항목은 미검증으로 보고한다.

공식 출처는 `SOURCES.md` 참조.
