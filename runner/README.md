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
