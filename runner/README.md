# 심부름꾼(Runner) — 작업용 PC에 두는 프로그램

폴더 구성 (C:\CBAO):
- `serviceAccount.json` — Firebase 열쇠. **비밀.** 이 PC 밖으로 내보내지 않는다. (git 에 올리지 않음)
- `runner\install.bat` — 처음 한 번 더블클릭 (Python 패키지 설치)
- `runner\start.bat` — 켤 때마다 더블클릭. 창을 닫으면 꺼진다 (사무실에 '오프라인'으로 표시됨)
- `runner\config.json` — PC 이름, 동시 실행 수(기본 1), 작업 폴더 지정
- `projects\<프로젝트ID>\` — 작업 폴더. 없으면 자동 생성. 다른 폴더를 쓰려면 config.json 의 `projects` 에 `"CBSR": "C:\\\\경로"` 로 적는다
- `runs\*.log` — 실행 로그

동작: 10초마다 heartbeat → 설치된 claude/codex 를 관리형 팀원으로 등록 → 사무실에서 **실행 요청**한 작업을 한 번에 하나만 실행 → 끝나면 실행 로그·요약을 결과물로 남기고 **승인 요청**을 만든다. 완료 판정은 사람이 승인함에서 한다.

Python 3.10 이상 필요. Claude Code(`claude`)와 Codex(`codex`)는 이 PC에 설치·로그인되어 있어야 하며, 없으면 해당 팀원은 등록되지 않는다.

## v0.7.0 — 프로젝트별 가지(branch) 흐름
사무실 → 프로젝트 → 수정 에서 세 칸을 채우면 Runner 가 그대로 따릅니다.

| 칸 | 뜻 | CBSR 예 |
|---|---|---|
| 작업 가지 | 원본이 있는 가지. Runner 가 여기를 내려받고 AI 가 여기서 고친다 | `source` |
| 빌드 명령 | 반영 때 돌릴 명령. 스크립트에 폴더가 있으면 그 폴더에서 실행 | `python app/build_site.py` |
| 배포 폴더 → 배포 가지 | 빌드 결과 폴더를 통째로 올릴 가지 | `app/site` → `main` |

- 비워 두면 예전과 같이 main 에서 고치고 main 에 반영합니다.
- 반영 순서: 작업 가지 커밋·push → 빌드 → 배포 폴더를 배포 가지에 커밋·push. 배포 폴더는 작업 가지 커밋에 섞이지 않습니다.
- 폴더가 다른 가지에 있고 올리지 않은 변경이 있으면 `git stash` 로 보관한 뒤 작업 가지로 옮기고, 대화방에 알립니다.
- AI 가 쓸 수 있는 명령이 늘었습니다: `git show/ls-tree/ls-files/branch/blame/grep/fetch`, `node`, `python`, `npx`, `pip install`, `ls/cat/head/tail/find`. 커밋·push·가지 바꾸기는 여전히 AI 가 못 하고 Runner 가 '반영' 때만 합니다.

## v0.8.0 — 대화 중심 업무실 (V2)
- `config.json` 에 `"workspace_uid": "<장부 UID>"` 를 적어 어느 장부를 쓸지 고정하세요 (웹 사무실 → 설정 → 연결 에 표시). 장부가 여러 개면 적지 않은 채로는 시작하지 않습니다.
- `cbao_v2.py` 가 새로 필요합니다 (runner.py 옆에 둡니다).
- 대화방마다 `C:\CBAO\worktrees\<프로젝트>\<대화방ID>` 작업 폴더와 가지 `office/<대화방ID>` 를 씁니다. 프로젝트 본 폴더(`C:\CBAO\projects\…`)는 반영 때만 씁니다.
- 턴 종류: 논의(읽기 도구만) / 실행(수정 → 끝나면 바뀐 파일만 체크포인트 커밋) / 검토(고정 SHA 의 읽기 전용 사본, 결과는 JSON 판정만 인정).
- 소유자 버튼: 체크포인트 저장 / 원격 공유(office 가지 push) / 반영(작업 가지에 merge → push → 빌드 → 배포 가지). 세 가지는 서로 다릅니다. push 는 배포 완료가 아닙니다.
- 앱(터미널)에서 같은 폴더를 고치면 30초 안에 '커밋 안 된 변경' 또는 '앱에서 저장한 새 버전'으로 대화방에 표시됩니다. 터미널 Claude 세션이 열려 있는 동안 오피스는 그 폴더에서 실행 턴을 시작하지 않습니다.
- 메시지는 `threads/{id}/messages` 하위 컬렉션에 하나씩 저장합니다. 시작할 때 예전 대화방(배열)을 옮기며 원본 배열은 지우지 않습니다. Firestore 규칙에 messages 하위 컬렉션 허용이 필요합니다 (`src/firebase/firestore.rules`).
- 정책(허용 명령·기능 지원 여부)은 heartbeat 에 실어 보내고, 웹 '정책' 화면은 그 데이터를 그대로 보여 줍니다.
- 시험: `python runner/tests/test_v2_flow.py` (Firebase·실제 CLI 없이 가짜 CLI 로 수직 흐름 28개 검사).
