# LoopGauge

[English](README.md) | [한국어](README.ko.md)

[![CI](https://github.com/josephuk77/LoopGauge/actions/workflows/ci.yml/badge.svg)](https://github.com/josephuk77/LoopGauge/actions/workflows/ci.yml)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Find the cheapest LLM policy that still passes your project's quality gate.**

LoopGauge is a provider-neutral experiment harness. Unlike a request router, it runs cheaper model, prompt, reasoning, retry, and escalation policies against representative project tasks before recommending one.

It does **not** choose an AI company for you. You enter the provider and the model you currently use. That model becomes the teacher baseline; LoopGauge discovers cheaper coding-capable candidates only from the same provider and refuses every other company.

> Status: experimental MVP. Run it on representative tasks in a disposable project before relying on its recommendations.

## 60-second API-free demo

```bash
git clone https://github.com/josephuk77/LoopGauge.git
cd LoopGauge
npm ci
npm run demo
```

The demo makes zero provider calls. It replays synthetic observations to show why LoopGauge rejects the cheapest policy below the quality gate and selects the cheapest eligible guarded policy.

```text
PASS  sonnet-verify     quality  97.4  success 100%  $0.072/approved
FAIL  haiku-direct      quality  89.1  success  80%  $0.026/approved
PASS  haiku-guarded     quality  96.4  success 100%  $0.057/approved

Selected: Claude Haiku 4.5 + validation + Opus escalation
```

These values are explicitly synthetic and are not a model-performance or savings claim. See the [benchmark methodology](docs/benchmark-methodology.md) before publishing real results.

## What it measures

Before optimization, LoopGauge reports a price-based savings range, candidate models, assumptions, and confidence. After real runs, it reports:

- measured and amortized cost savings;
- functional quality and quality relative to the teacher baseline;
- behavioral/structural/text similarity and the inverse difference score;
- success rate and cost per successful task;
- optimization spend and break-even run count;
- only improvement opportunities supported by observed experiments.

Quality is a constraint, not something that can be traded away invisibly:

1. reject candidates that fail mandatory build or test checks;
2. reject candidates below the configured baseline ratio (95% by default);
3. among eligible candidates, choose the lowest cost per successful task.

## Architecture

```text
Codex / Claude
      │ MCP
      ▼
LoopGauge CLI + MCP server
      ├── provider policy gate
      ├── OpenAI Codex adapter
      ├── Anthropic Agent SDK adapter
      ├── isolated Git worktrees
      ├── validation + similarity scoring
      ├── budget-bounded search loop
      └── SQLite state + JSONL traces
```

The adapters normalize sessions, events, tool usage, tokens, cost, cancellation, and final results. The optimizer varies automatically discovered same-provider models, reasoning effort, prompt policy, tool policy, verification, retry, and escalation back to the user's current model.

## Why this is not another router

| Request router | LoopGauge |
| --- | --- |
| Chooses a model for a live request | Experiments before recommending a production policy |
| Often predicts task difficulty | Measures actual project checks and results |
| Optimizes per-call routing | Optimizes total cost per successful task |
| May omit failed and retry cost | Includes retry, judge, failure, and escalation cost |
| Returns a routing decision | Returns evidence, quality scores, savings, and break-even |

## Requirements

- Node.js 22 or newer
- Git
- API keys for the providers you select
- a committed, clean Git project to optimize
- at least one representative task; three to five are recommended

Credentials are read from `OPENAI_API_KEY`/`CODEX_API_KEY` and `ANTHROPIC_API_KEY`. They are never written to `loop.yaml`, SQLite, or JSONL traces. Library consumers can supply another `CredentialResolver`, including an OS credential-store implementation.

## Install and build

```bash
npm install
npm run build
npm test
```

Run the local CLI without a global install:

```bash
node dist/cli.js help
```

## Configure a project

The company and current model are the only model choices the user must make:

```bash
# Current workflow uses OpenAI GPT-5.6
node dist/cli.js init --provider openai --model gpt-5.6 --name my-project

# Current workflow uses Anthropic Claude Sonnet 5
node dist/cli.js init --provider anthropic --model claude-sonnet-5 --name my-project
```

Edit the generated `loop.yaml` before running anything:

- verify setup/build/test/lint/typecheck commands;
- replace the sample tasks with real recurring work;
- optionally set `baselinePatchPath` to compare against an existing result.

On `analyze`, LoopGauge queries the selected provider's Models API when an API key is available, intersects that response with its dated coding-model price catalog, and selects up to `maxCandidates` models that are both lower-ranked and cheaper than the current model. It removes candidates dominated on both capability and price, while retaining close-quality choices and the cheapest endpoint. If the API cannot be reached, it falls back to the built-in catalog and reports that fact as a warning. It never discovers candidates from another provider.

The built-in catalog is dated `2026-07-16` and is based on the official [OpenAI model catalog](https://developers.openai.com/api/docs/models), [OpenAI Models API](https://platform.openai.com/docs/api-reference/models), [Anthropic model overview](https://platform.claude.com/docs/en/about-claude/models/overview), and [Anthropic Models API](https://platform.claude.com/docs/en/api/models/list). Every optimization report records the catalog timestamp.

## CLI workflow

```bash
# Read-only project detection plus preflight estimate
node dist/cli.js analyze --config loop.yaml

# Run teacher/candidate experiments in disposable worktrees
node dist/cli.js optimize --config loop.yaml

# Inspect a completed job
node dist/cli.js report --job JOB_ID --config loop.yaml
node dist/cli.js compare --job JOB_ID --config loop.yaml

# Run the selected policy; returns a patch without modifying the source checkout
node dist/cli.js run --job JOB_ID --prompt "Implement the next task" --config loop.yaml

# Continue a cancelled or interrupted job using persisted completed runs
node dist/cli.js optimize --resume JOB_ID --config loop.yaml
```

State lives under `.loopgauge/`:

- `loopgauge.db`: jobs, evaluated runs, and reports;
- `events/*.jsonl`: replayable agent and job events;
- `generated/`: provider-specific instructions only for selected providers.

Temporary Git worktrees are created under the operating system temp directory and removed after every run.

## MCP tools

Start the stdio server:

```bash
node dist/mcp/server.js
```

It exposes:

- `analyze_project`
- `estimate_savings`
- `optimize_harness`
- `get_optimization_status`
- `cancel_optimization`
- `resume_optimization`
- `run_optimized_task`
- `compare_results`
- `get_cost_report`

Local MCP configuration shape for either client:

```json
{
  "mcpServers": {
    "loopgauge": {
      "command": "node",
      "args": ["/absolute/path/to/LoopGauge/dist/mcp/server.js"]
    }
  }
}
```

Use the client-specific MCP configuration location documented by [Codex](https://learn.chatgpt.com/docs/extend/mcp) or [Claude Code](https://code.claude.com/docs/en/mcp).

## Scoring and cost accounting

Default functional quality weights:

| Component | Weight |
| --- | ---: |
| Build and tests | 60 |
| Requirement grader | 20 |
| Regression checks | 10 |
| Lint and type checks | 10 |

Default result similarity weights:

| Component | Weight |
| --- | ---: |
| Behavioral check outcomes | 70 |
| Public API / structural tokens | 20 |
| Normalized text diff | 10 |

The difference score is `100 - similarity`. A score is evidence for a defined test set, not proof that two models think alike or will behave identically on arbitrary future work.

Cost includes input, output, cache reads/writes, configured tool charges, retries, optional judge runs, and opt-in escalation. If an SDK reports authoritative run cost, LoopGauge uses it while retaining the token-level breakdown. Every report records its price-catalog timestamp.

## Safety boundaries

- Optimization requires a clean repository and at least one commit.
- Experiments run with bounded iterations and budgets in detached worktrees.
- Network access is off by default.
- Provider/model policy is checked immediately before every agent call.
- Automatic discovery never crosses the provider selected for the current model.
- API/provider failures are persisted and scored as failures rather than silently ignored.
- LoopGauge does not collect or imitate hidden chain-of-thought; it optimizes observable prompts, actions, checks, costs, and outcomes.

## Development

```bash
npm run typecheck
npm test
npm run build
```

The test suite covers provider deny-by-default behavior, price accounting, quality gates, similarity scores, the API-free demo, and a real temporary Git-worktree optimization run.

Project resources:

- [Benchmark methodology](docs/benchmark-methodology.md)
- [Benchmarks](benchmarks/README.md)
- [Roadmap](docs/roadmap.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Changelog](CHANGELOG.md)
- [Unofficial Korean MIT License translation](LICENSE.ko.md)

The package is prepared for a public npm release but has not been published yet. Until then, use the local build shown above.

## License

MIT
