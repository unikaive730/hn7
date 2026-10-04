# BeeGuard Lab 인계 문서

다른 세션이 이 파일만 읽고 이어받을 수 있게 쓴 것이다. 아래 "복붙 프롬프트"를 새 세션에 그대로 붙이면 된다.

## 상황

- 대회: Hack-Nation 7th Global AI Hackathon, 과제 3 (Databricks · Agentic Scientific Discovery)
- 마감: **2026-10-04 22:00 KST** (유예 22:15). 21:00 기능 동결
- 팀: MarketPilot, 1인 (김효건, ceo@marketpilot.it)
- 저장소: `C:\Users\windr\github\hn7` · GitHub `unikaive730/hn7` (비공개, 제출 직전 공개로 전환)
- 작업 폴더: `C:\Users\windr\me\해커톤_HackNation7_2026\` (과제 PDF·기획·조사 전부 여기)

## 배점과 제출물

배점: Omnigent orchestration 30 · breakthrough potential 25 · discovery acceleration and learning 20 · scientific rigor 15 · creativity and responsibility 10

제출물 (HackOS와 구글 폼 **둘 다**):
- 공개 GitHub 저장소
- 라이브 데모 링크 (실제로 돌아가야 함)
- 영상 3개: Demo · Tech · Team, 각 60초 이하 MP4/MOV
- 팀 사진 (`C:\Users\windr\me\해커톤_HackNation7_2026\작성본\팀사진_후보\` 1순위 사용)
- 2분 데모 영상 (과제 원문 요구, README에 링크)

## 만든 것 (전부 실제로 돌아가는 것 확인됨)

| 경로 | 내용 |
|---|---|
| `lab/scripts/fetch_data.py` | ApisTox 데이터 받기 + SHA256 |
| `lab/scripts/baseline.py` | 기준선 재현 (AUROC 0.795) |
| `lab/scripts/discovery.py` | 발견 곡선 측정 |
| `lab/beeguard/engine.py` | 실시간 엔진 (실험 1회 0.007초) |
| `lab/beeguard/sources.py` | OpenAlex·Europe PMC·PubChem·arXiv 실제 호출 |
| `lab/beeguard/tools.py` | 에이전트 도구 9개 + 연구 기록 |
| `lab/beeguard/policies.py` | 사람 승인 게이트 (반환 키는 `result`, `decision` 아님) |
| `lab/beeguard/mcp_server.py` | 도구를 MCP로 노출 |
| `lab/beeguard/api.py` | FastAPI (포트 8900) |
| `lab/beeguard/curve.py` | 발견 곡선·전략 비교·시대별 비교 (API 연결 아직 안 됨) |
| `agents/beeguard/` | Omnigent 에이전트 번들 |
| `apps/web/` | React 화면 (Tailwind 4 · framer-motion · recharts · lucide) |

## 측정된 숫자 (지어내지 말 것, 전부 실행 결과)

- 데이터: 분자 1,035개, 2000년 기준 학습 834 / 시험 201, 숨은 정답 13개
- 기준선 AUROC 0.795
- 예산 30: 13개 전부 발견, 무작위 191회 필요, **6.37배**
- 예산 60: 13개 전부, **3.18배**
- 반증 시험: 아는 골격 0.8995 / 처음 보는 골격 0.748 (격차 0.15), **정답 13개 중 8개가 처음 보는 골격**

## 핵심 함정 (다시 겪지 말 것)

1. **Omnigent 하위 에이전트는 YAML 안에 못 쓴다.** `agents/beeguard/agents/<이름>/config.yaml`로 각각 별도 폴더여야 발견된다 (`parser.py` `_discover_sub_agents`)
2. **정책은 `guardrails.policies:` 아래**여야 한다. 최상위 `policies:`는 무시된다
3. **정책 반환 키는 `result`** (`{"result": "ASK"}`). `decision`이면 거부된다
4. **MCP 명령은 절대 경로**여야 한다. 상대 경로는 엉뚱한 곳에서 찾는다
5. 윈도우에서는 `PYTHONUTF8=1` 필수 (없으면 cp949 오류로 Omnigent 데몬이 안 붙는다)
6. 비대화 모드(`-p`)에서는 승인을 누를 수 없어 실험이 ASK에서 멈춘다. 정상 동작이다

## 실행 방법

```bash
cd C:/Users/windr/github/hn7

# 데이터 (이미 받아져 있음)
PYTHONUTF8=1 lab/.venv/Scripts/python.exe lab/scripts/fetch_data.py

# API 서버 (포트 8900)
PYTHONUTF8=1 lab/.venv/Scripts/python.exe -m uvicorn lab.beeguard.api:app --port 8900

# 웹 (포트 5173, /api를 8900으로 넘김)
cd apps/web && npm run dev

# 에이전트 연구실
bash scripts/lab.sh "Run one full discovery loop."
```

## 남은 일 (순서대로)

1. **볼륨 키우기 (진행 중)**: `curve.py`를 API에 연결하고 화면에 추가
   - 발견 곡선 그래프 (recharts, 무작위 범위를 띠로)
   - 에이전트 대화 패널 (근거 → 가설 → 두 실험 비교 → 결정 이유)
   - 분자 클릭 시 상세 + PubChem 실제 조회
   - 연구 기록 전체 보기
   - 전략 3개 나란히 비교
   - 시대별(1990/2000/2010) 재현
2. **배포**: Hugging Face Spaces (무료, 16GB). 계정 필요 → 세션이 만들어 보고 막히면 대표에게
3. **영상 3개**: 녹화 도구는 `C:\Users\windr\github\hacknation7\scripts\video\`에 있음 (이전 저장소, 복사해 쓸 것)
   - 팀 영상 대본: `C:\Users\windr\me\해커톤_HackNation7_2026\작성본\팀영상\`
   - 대표는 영어로 말하지 않음 → 자막 + AI 내레이션
4. **README·1쪽 보고서**: 틀이 `C:\Users\windr\me\해커톤_HackNation7_2026\작성본\템플릿\`에 있음
5. **제출**: HackOS(프로젝트 초안 이미 저장됨, 과제 03 선택됨) + 구글 폼

## 대표 지시 (지킬 것)

- 데이터 소스는 **실제로 쓰는 것만** 표시. 많이 쓴 것처럼 꾸미지 않는다
- UI/UX는 입체적·다이나믹하게, 심사위원이 감탄하도록
- 세션 대화는 한국어
- 커밋은 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## 복붙 프롬프트

```
Hack-Nation 7 해커톤 과제 3(Databricks Agentic Scientific Discovery) 작업을 이어받아.

먼저 C:\Users\windr\github\hn7\HANDOFF.md 를 읽어. 거기에 지금까지 만든 것, 측정된 숫자,
다시 겪지 말아야 할 함정 6가지, 남은 일이 순서대로 적혀 있어.

마감은 오늘 22:00 KST, 21:00 기능 동결이야. 지금 시각을 확인하고 남은 일 중
"볼륨 키우기"부터 이어서 해줘. 끝나면 배포, 영상 3개, README, 제출 순서야.

규칙: 숫자는 지어내지 말고 실제 실행 결과만 쓸 것. 데이터 소스는 실제로 호출하는 것만
화면에 표시할 것. UI는 입체적이고 다이나믹하게. 세션 대화는 한국어로.
커밋 메시지 끝에 Co-Authored-By: Claude Opus 5 <noreply@anthropic.com> 를 붙일 것.

중간에 확인이 필요하면 물어보고, 아니면 끝까지 진행해.
```
