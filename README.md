# LoopGauge

LoopGauge is a provider-neutral loop engineering harness that searches for the lowest-cost coding-agent policy that still passes a user-defined quality gate.

It does **not** choose an AI company for you. You explicitly allow OpenAI, Anthropic, or both in `loop.yaml`; LoopGauge refuses every provider and model outside that allowlist. Cross-provider comparison and fallback are opt-in.

> Status: experimental MVP. Run it on representative tasks in a disposable project before relying on its recommendations.

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

The adapters normalize sessions, events, tool usage, tokens, cost, cancellation, and final results. The optimizer varies only user-authorized models, reasoning effort, prompt policy, tool policy, verification, retry, and (when opted in) escalation.

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

The company is a required user choice:

```bash
# OpenAI only
node dist/cli.js init --provider openai --name my-project

# Anthropic only
node dist/cli.js init --provider anthropic --name my-project

# Both companies are allowed, but roles remain manually selected
node dist/cli.js init --provider both --name my-project
```

Edit the generated `loop.yaml` before running anything:

- replace placeholder model IDs;
- enter a dated price snapshot for every allowed model;
- update `priceCatalogAsOf` to the timestamp of that snapshot;
- select teacher, candidate, and optional judge roles;
- verify setup/build/test/lint/typecheck commands;
- replace the sample tasks with real recurring work;
- optionally set `baselinePatchPath` to compare against an existing result.

`selectionMode: manual` runs only the explicit candidate list. `auto-within-allowlist` may compare every model in `allowedModels` and may escalate a failed production run to the configured teacher. It still cannot leave `allowedProviders` or `allowedModels`.

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
- Manual mode never performs automatic provider fallback.
- API/provider failures are persisted and scored as failures rather than silently ignored.
- LoopGauge does not collect or imitate hidden chain-of-thought; it optimizes observable prompts, actions, checks, costs, and outcomes.

## Development

```bash
npm run typecheck
npm test
npm run build
```

The test suite covers provider deny-by-default behavior, price accounting, quality gates, similarity scores, and a real temporary Git-worktree optimization run.

## License

MIT
