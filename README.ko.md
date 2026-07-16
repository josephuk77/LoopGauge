# LoopGauge

[English](README.md) | 한국어

[![CI](https://github.com/josephuk77/LoopGauge/actions/workflows/ci.yml/badge.svg)](https://github.com/josephuk77/LoopGauge/actions/workflows/ci.yml)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**프로젝트의 품질 기준을 통과하는 가장 저렴한 LLM 실행 정책을 찾습니다.**

LoopGauge는 단순 요청 라우터가 아니라 공급자 중립형 실험 하네스입니다. 실제 프로젝트의 대표 작업에서 저비용 모델, 프롬프트, 추론 강도, 재시도와 상위 모델 승격 정책을 실행한 뒤 검증된 정책을 추천합니다.

LoopGauge가 사용할 AI 회사를 임의로 선택하지 않습니다. 사용자는 현재 사용하는 회사와 기준 모델 하나만 입력합니다. LoopGauge는 같은 회사의 더 저렴한 코딩 가능 모델을 자동으로 불러오며, 다른 회사는 후보 검색·평가·fallback을 포함해 호출하지 않습니다.

> 현재 상태는 실험용 MVP입니다. 실제 프로젝트에 적용하기 전에 별도의 테스트 프로젝트와 대표 작업으로 결과를 검증하세요.

## 60초 API 무료 데모

```bash
git clone https://github.com/josephuk77/LoopGauge.git
cd LoopGauge
npm ci
npm run demo
```

데모는 공급자 API를 한 번도 호출하지 않습니다. 합성 관측값을 재생해 가장 싼 후보가 품질 하한 때문에 탈락하고, 검증과 승격을 포함한 최저비용 통과 정책이 선택되는 과정을 보여줍니다.

```text
PASS  sonnet-verify     quality  97.4  success 100%  $0.072/approved
FAIL  haiku-direct      quality  89.1  success  80%  $0.026/approved
PASS  haiku-guarded     quality  96.4  success 100%  $0.057/approved

Selected: Claude Haiku 4.5 + validation + Opus escalation
```

위 숫자는 모두 합성 데이터이며 실제 모델 성능이나 비용 절감 주장으로 사용할 수 없습니다. 실제 결과를 공개하기 전 [벤치마크 방법론](docs/benchmark-methodology.md)을 따라야 합니다.

## 무엇을 해결하나요?

반복되는 코딩 작업을 항상 고성능 모델로 처리하면 품질은 높지만 API 비용이 커집니다. 반대로 저비용 모델만 사용하면 작업 성공률이 떨어질 수 있습니다.

LoopGauge는 이 문제를 다음과 같이 다룹니다.

1. 사용자는 현재 사용 중인 기준 모델 하나만 정하고, LoopGauge가 같은 회사의 저비용 후보를 불러옵니다.
2. 실제 프로젝트의 대표 작업을 깨끗한 Git worktree에서 반복 실행합니다.
3. 테스트, 빌드, 린트, 타입 검사와 선택적 judge로 결과를 평가합니다.
4. 프롬프트, 추론 강도, 검증 방식, 재시도 정책을 바꿔가며 후보를 탐색합니다.
5. 품질 하한을 통과한 후보 중 성공 작업당 총비용이 가장 낮은 정책을 선택합니다.
6. 최적화 비용, 실제 절감률, 결과 차이, 손익분기점과 추가 개선 가능성을 보고합니다.

목표는 높은 모델의 비공개 사고 과정을 복사하는 것이 아닙니다. 관찰 가능한 프롬프트, 도구 사용, 코드 변경, 검증 결과, 토큰 사용량과 비용을 이용해 반복 작업용 실행 루프를 개선합니다.

## 핵심 원칙

- **회사 선택권:** OpenAI나 Anthropic 중 현재 사용하는 회사를 사용자가 직접 정합니다.
- **기준 모델 하나:** 사용자는 현재 모델만 입력하고, 저비용 후보 구성은 LoopGauge가 담당합니다.
- **동일 회사 제한:** 자동 발견은 현재 모델과 같은 회사 안에서만 이루어집니다.
- **비용 우선:** 품질 하한을 통과한 후보 중 비용이 가장 낮은 정책을 선택합니다.
- **검증 가능한 품질:** 단순 응답 유사도가 아니라 테스트와 실제 코드 변경을 평가합니다.
- **격리 실행:** 모든 실험은 원본 저장소가 아닌 임시 Git worktree에서 실행합니다.
- **안전한 승격:** 저비용 정책이 실패하면 사용자가 입력한 현재 모델로만 승격합니다.
- **예산 제한:** 작업별 예산, 전체 최적화 예산, 최대 반복 횟수와 무개선 종료 조건을 적용합니다.

## 전체 작동 구조

```text
Codex 또는 Claude
        │ MCP
        ▼
LoopGauge CLI / MCP 서버
        │
        ├─ 공급자·모델 허용 정책 검사
        ├─ OpenAI Codex 어댑터
        ├─ Anthropic Agent SDK 어댑터
        ├─ 임시 Git worktree 생성
        ├─ 기준 모델과 후보 모델 실행
        ├─ 테스트·빌드·정적 검사
        ├─ 품질·유사도·비용 계산
        ├─ 예산 및 종료 조건 검사
        └─ SQLite 상태 + JSONL 이벤트 저장
```

## 일반 모델 라우터와의 차이

| 일반 요청 라우터 | LoopGauge |
| --- | --- |
| 실시간 요청의 모델을 선택 | 운영 정책을 추천하기 전에 반복 실험 |
| 작업 난이도를 예측하는 경우가 많음 | 실제 프로젝트 검사와 결과를 측정 |
| 호출당 비용 중심 | 성공 작업당 총비용 중심 |
| 실패·재시도 비용이 빠질 수 있음 | 재시도·judge·실패·승격 비용 포함 |
| 라우팅 결과 반환 | 품질·비용·절감률·손익분기 증거 반환 |

### 1. 설정 읽기

`loop.yaml`에서 다음 내용을 읽습니다.

- 현재 사용 중인 회사와 기준 모델 하나
- 자동 발견할 최대 저비용 후보 수
- 반복 작업을 대표하는 1~20개의 표본 작업
- 설치, 빌드, 테스트, 린트와 타입 검사 명령
- 날짜가 기록된 내장 모델 가격 카탈로그
- 품질 하한과 점수 가중치
- 최적화 및 작업별 최대 비용
- 탐색할 추론 강도와 프롬프트 정책

### 2. 실행 전 예상

`analyze`는 프로젝트의 패키지 생태계와 검사 명령을 탐지합니다. API 키가 있으면 선택한 회사의 Models API에서 현재 계정이 사용할 수 있는 모델을 조회하고, 내장 가격 카탈로그와 대조해 기준 모델보다 저렴한 코딩 가능 후보를 구성합니다. API 조회가 불가능하면 날짜가 기록된 내장 카탈로그를 사용하고 경고를 표시합니다.

이 단계의 수치는 실제 실행 결과가 아닌 가격 기반 추정치입니다. 카탈로그에 기준 모델의 검증된 가격이 없으면 가격을 추측하지 않고 실행을 중단합니다.

### 3. 기준선 생성

teacher 모델이 대표 작업을 여러 번 수행합니다. 각 실행은 현재 커밋에서 만든 별도의 worktree에서 진행되며 다음 정보가 저장됩니다.

- 생성된 Git patch
- 빌드와 테스트 결과
- 린트와 타입 검사 결과
- 입력·출력·캐시 토큰
- 도구 호출 횟수
- 모델 또는 SDK가 보고한 비용
- 실행 시간과 성공 여부

기존 작업물과 비교하려면 표본 작업의 `baselinePatchPath`에 기존 patch 파일을 지정할 수 있습니다.

### 4. 후보 탐색 루프

후보 모델마다 다음 조합을 제한된 횟수 안에서 시험합니다.

- `plain`: 원래 작업 지시
- `verify`: 완료 전에 프로젝트 검사를 실행하도록 강화
- `budget-aware`: 필요한 문맥만 읽고 관련 없는 변경을 피하도록 제한
- `low`, `medium` 등의 추론 강도
- 허용된 도구 목록
- 검증 실패 시 한 번의 수정 재시도
- 선택적 독립 judge 평가

각 반복 뒤에는 누적 비용, 남은 반복 횟수와 품질 개선 여부를 확인합니다. 예산을 소진하거나 설정된 횟수만큼 개선이 없으면 루프를 종료합니다.

### 5. 정책 선택

선택 순서는 다음과 같습니다.

1. 필수 빌드 또는 테스트가 실패한 후보를 탈락시킵니다.
2. 평균 품질이 기준선의 95% 미만인 후보를 탈락시킵니다. 기본값은 변경할 수 있습니다.
3. 모든 표본 작업에서 성공한 후보만 남깁니다.
4. 통과한 후보 중 **성공 작업당 총비용**이 가장 낮은 정책을 선택합니다.

단순히 가장 싼 모델을 선택하는 방식이 아닙니다. 값싼 모델이 여러 번 실패하면 재시도 비용 때문에 더 비싼 후보보다 불리하게 계산됩니다.

## 점수 계산

### 기능 품질 점수

기본값은 총 100점입니다.

| 항목 | 기본 배점 |
| --- | ---: |
| 빌드와 테스트 | 60점 |
| 요구사항 충족도 | 20점 |
| 회귀 검사 | 10점 |
| 린트와 타입 검사 | 10점 |

필수 빌드나 테스트가 실패하면 다른 점수가 높아도 후보에서 탈락합니다. `judge`를 설정하면 요구사항 충족도는 judge가 반환한 0~1 점수를 사용합니다. judge가 없으면 표본에 설정한 `requirementScore`를 사용합니다.

### 결과물 일치도와 차이 점수

| 항목 | 기본 가중치 |
| --- | ---: |
| 검사 결과의 행동 일치 | 70% |
| 공개 API와 구조 토큰 | 20% |
| 정규화된 텍스트 diff | 10% |

`차이 점수 = 100 - 일치도`입니다.

이 점수는 설정된 대표 작업과 검사 범위에서의 차이를 뜻합니다. 두 모델이 항상 동일하게 동작하거나 같은 방식으로 추론한다는 의미는 아닙니다.

### 비용 계산

다음 비용을 모두 포함합니다.

- 입력 토큰
- 출력 토큰
- 캐시 읽기와 쓰기
- 가격표에 등록된 도구 호출
- 실패한 첫 실행과 재시도
- 선택적 judge 실행
- 자동 모드에서의 teacher 승격
- 하네스를 찾기 위해 먼저 사용한 최적화 비용

보고서에는 다음 값이 따로 표시됩니다.

- 실행당 실제 절감률
- 최적화 비용까지 포함한 100회 기준 상각 절감률
- 성공 작업당 비용
- 초기 최적화 비용
- 손익분기 실행 횟수

## 설치 방법

### 1. 저장소 받기

```bash
git clone https://github.com/josephuk77/LoopGauge.git
cd LoopGauge
```

### 2. 의존성 설치와 빌드

```bash
npm install
npm run build
npm test
```

필요 조건:

- Node.js 22 이상
- Git
- 선택한 회사의 API 키
- 최소 한 번 커밋되고 변경 사항이 없는 대상 Git 프로젝트
- 최소 1개의 대표 작업, 권장 3~5개

### 3. CLI 확인

```bash
node dist/cli.js help
```

## 프로젝트 설정 방법

### 1. 현재 사용하는 회사와 모델 입력

사용자가 정해야 하는 모델은 현재 사용하는 기준 모델 하나뿐입니다.

```bash
# 현재 GPT-5.6을 사용하는 경우
node dist/cli.js init --provider openai --model gpt-5.6 --name my-project

# 현재 Claude Sonnet 5를 사용하는 경우
node dist/cli.js init --provider anthropic --model claude-sonnet-5 --name my-project
```

이 명령은 현재 폴더에 `loop.yaml`을 만듭니다. 기존 파일을 교체해야 할 때만 `--force`를 사용합니다.

### 2. `loop.yaml` 수정

[loop.example.yaml](loop.example.yaml)을 참고합니다. 모델 설정은 다음처럼 단순합니다.

```yaml
providers:
  modelDiscovery:
    current:
      provider: anthropic
      model: claude-sonnet-5
    maxCandidates: 4
    refreshFromProvider: true
```

위 예시에서는 `claude-sonnet-5`가 teacher 기준선이 됩니다. LoopGauge는 Anthropic Models API와 내장 가격 카탈로그를 대조해 더 저렴한 후보를 최대 4개까지 구성합니다. OpenAI를 선택하면 OpenAI 안에서만 같은 절차를 수행합니다.

반드시 다음 항목도 확인하세요.

- `project.root`: 최적화할 프로젝트 경로
- `project.commands`: 실제 프로젝트에서 성공하는 명령
- `task.samples`: 반복 작업을 대표하는 작업과 예외 사례
- `optimization.budgetUsd`: 전체 최적화에 쓸 수 있는 최대 비용
- `optimization.perRunBudgetUsd`: 한 번의 실행에 허용할 최대 비용

내장 카탈로그는 `2026-07-16` 기준이며 [OpenAI 모델 카탈로그](https://developers.openai.com/api/docs/models), [OpenAI Models API](https://platform.openai.com/docs/api-reference/models), [Anthropic 모델 개요](https://platform.claude.com/docs/en/about-claude/models/overview), [Anthropic Models API](https://platform.claude.com/docs/en/api/models/list)를 기준으로 작성되었습니다. 모든 보고서에 사용한 카탈로그 시각이 기록됩니다.

### 3. API 키 설정

PowerShell:

```powershell
$env:OPENAI_API_KEY = "키"
$env:ANTHROPIC_API_KEY = "키"
```

Bash, zsh:

```bash
export OPENAI_API_KEY="키"
export ANTHROPIC_API_KEY="키"
```

선택하지 않은 회사의 키는 필요하지 않습니다. 키는 `loop.yaml`, SQLite와 JSONL 로그에 저장되지 않습니다.

## 실행 방법

### 1. 프로젝트 분석과 사전 예상

```bash
node dist/cli.js analyze --config /대상/프로젝트/loop.yaml
```

확인할 내용:

- 프로젝트 종류가 올바르게 탐지됐는가?
- 설치, 빌드, 테스트 명령이 실제 명령과 일치하는가?
- 현재 기준 모델과 자동 발견 후보가 의도한 회사 안에 있는가?
- 모델 조회가 API 결과인지 내장 카탈로그 fallback인지 확인했는가?
- 대표 작업이 3개 이상인가?

### 2. 최적화 시작

```bash
node dist/cli.js optimize --config /대상/프로젝트/loop.yaml
```

진행 중에는 현재 단계와 누적 비용이 stderr에 표시됩니다. 완료되면 job ID와 선택된 모델, 품질, 결과 차이, 성공률, 절감률과 손익분기점이 출력됩니다.

JSON 결과가 필요하면 다음과 같이 실행합니다.

```bash
node dist/cli.js optimize --config /대상/프로젝트/loop.yaml --json
```

### 3. 보고서 다시 보기

```bash
node dist/cli.js report --job JOB_ID --config /대상/프로젝트/loop.yaml
```

job ID를 생략하면 가장 최근 작업을 표시합니다.

```bash
node dist/cli.js report --config /대상/프로젝트/loop.yaml
```

### 4. 후보 비교

```bash
node dist/cli.js compare --job JOB_ID --config /대상/프로젝트/loop.yaml
```

각 후보의 품질, 기준선 대비 비율, 성공률, 일치도, 차이 점수와 성공당 비용을 JSON으로 보여줍니다.

### 5. 선택된 정책으로 새 작업 실행

```bash
node dist/cli.js run \
  --job JOB_ID \
  --prompt "새 API 엔드포인트를 추가하고 테스트를 작성해" \
  --config /대상/프로젝트/loop.yaml
```

이 명령도 원본 프로젝트를 직접 수정하지 않습니다. 임시 worktree에서 작업한 뒤 적용 가능한 Git patch를 JSON 결과로 반환합니다. 사용자가 patch를 검토한 뒤 직접 적용해야 합니다.

### 6. 중단된 최적화 재개

```bash
node dist/cli.js optimize \
  --resume JOB_ID \
  --config /대상/프로젝트/loop.yaml
```

이미 완료된 기준 및 후보 실행은 SQLite에서 읽어 재사용하며, 기존 누적 비용도 그대로 유지됩니다.

## MCP로 연결하기

MCP 서버를 직접 시작하려면 다음 명령을 사용합니다.

```bash
node dist/mcp/server.js
```

Codex 또는 Claude의 로컬 MCP 설정에 다음 형태로 등록합니다.

```json
{
  "mcpServers": {
    "loopgauge": {
      "command": "node",
      "args": ["/LoopGauge의/절대경로/dist/mcp/server.js"]
    }
  }
}
```

클라이언트마다 설정 파일 위치와 키 이름이 다를 수 있으므로 [Codex MCP 문서](https://learn.chatgpt.com/docs/extend/mcp) 또는 [Claude Code MCP 문서](https://code.claude.com/docs/en/mcp)를 함께 확인하세요.

제공되는 MCP 도구:

| 도구 | 기능 |
| --- | --- |
| `analyze_project` | 프로젝트와 허용 정책 분석 |
| `estimate_savings` | 실행 전 가격 기반 절감 범위 계산 |
| `optimize_harness` | 비동기 최적화 작업 시작 |
| `get_optimization_status` | 진행 상태와 누적 비용 확인 |
| `cancel_optimization` | 실행 중인 최적화 중단 요청 |
| `resume_optimization` | 저장된 실행을 이용해 작업 재개 |
| `run_optimized_task` | 선택된 정책으로 새 작업 실행 |
| `compare_results` | 기준선과 모든 후보 결과 비교 |
| `get_cost_report` | 비용, 절감률과 손익분기점 조회 |

## 저장되는 파일

대상 프로젝트의 `.loopgauge/` 아래에 상태가 저장됩니다.

```text
.loopgauge/
├─ loopgauge.db          작업, 실행 결과, 보고서
├─ events/*.jsonl        재현 가능한 실행 이벤트
└─ generated/
   ├─ AGENTS.md          OpenAI가 허용된 경우만 생성
   └─ CLAUDE.md          Anthropic이 허용된 경우만 생성
```

임시 worktree는 운영체제의 임시 폴더에 만들어지고 실행이 끝난 뒤 제거됩니다. `.loopgauge/`는 프로젝트 원본의 Git 상태 검사에서 제외됩니다.

## 모델 자동 선택 규칙

- 사용자가 입력한 현재 모델이 teacher 기준선이 됩니다.
- API 키가 있으면 해당 회사의 Models API로 실제 사용 가능 모델을 조회합니다.
- 코딩 에이전트용으로 검증된 내장 가격 카탈로그와 API 목록의 교집합만 후보가 됩니다.
- 기준 모델보다 실제 혼합 가격이 낮고 능력 등급도 낮은 모델만 선택합니다.
- 더 비싸면서 능력도 낮은 후보를 제거하고, 기준 모델에 가까운 후보와 가장 저렴한 끝점 후보를 합쳐 `maxCandidates`개까지 실험합니다.
- 품질 95% 하한을 통과한 후보 중 성공 작업당 실제 비용이 가장 낮은 정책을 채택합니다.
- 다른 회사 모델은 자동으로 검색하거나 fallback하지 않습니다.

## 주의사항과 현재 한계

- 실제 절감률은 대표 작업이 실제 운영 작업을 얼마나 잘 반영하는지에 따라 달라집니다.
- 테스트가 부족한 프로젝트에서는 높은 품질 점수가 실제 완성도를 보장하지 못합니다.
- 서로 다른 모델의 결과가 문장이나 코드 형태까지 완전히 같을 필요는 없습니다. 기능 품질과 정의된 유사도를 평가합니다.
- 모델 목록 API는 가격을 제공하지 않으므로 가격은 버전이 기록된 내장 공식 가격 스냅샷을 사용합니다. 카탈로그에 없는 기준 모델은 비용을 추측하지 않고 중단합니다.
- 실제 OpenAI 또는 Anthropic 호출은 API 비용을 발생시킵니다.
- Codex와 Claude가 제공하는 도구·권한 기능의 차이는 각 공급자 어댑터 내부에서 처리됩니다.
- 민감한 저장소에서는 JSONL 이벤트에 명령과 파일 변경 정보가 남을 수 있으므로 보관 정책을 확인하세요. API 키와 reasoning/thinking 내용은 저장 전에 제거됩니다.

## 개발 및 검증

```bash
npm run typecheck
npm test
npm run build
```

프로젝트 자료:

- [벤치마크 방법론](docs/benchmark-methodology.md)
- [로드맵](docs/roadmap.md)
- [기여 안내](CONTRIBUTING.md)
- [보안 정책](SECURITY.md)
- [변경 이력](CHANGELOG.md)

npm 공개 배포 준비는 완료했지만 아직 패키지를 발행하지 않았습니다. 그전까지는 위의 로컬 빌드 방법을 사용합니다.

테스트는 다음 동작을 검증합니다.

- 선택하지 않은 회사와 모델의 호출 차단
- 비용, 캐시, 도구, 재시도와 손익분기점 계산
- 60/20/10/10 품질 점수
- 결과 일치도와 차이 점수
- 실제 임시 Git 저장소와 worktree를 이용한 최적화
- MCP 도구 목록과 연결
- API 키와 추론 정보 로그 제거
- 선택된 회사에 해당하는 지침 파일만 생성

## 라이선스

MIT
