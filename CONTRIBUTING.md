# Contributing to LoopGauge

LoopGauge welcomes focused issues and pull requests around provider adapters, deterministic graders, price-catalog importers, and reproducible loop strategies.

Before submitting a change:

```bash
npm install
npm run demo
npm run typecheck
npm test
npm run build
```

The API-free demo is synthetic. Never present its values as measured model performance or savings. Real benchmark contributions must follow [the benchmark methodology](docs/benchmark-methodology.md).

Provider neutrality is a hard invariant:

- never add a default company or model recommendation to the core;
- never call a provider or model outside the project allowlist;
- keep provider-specific behavior behind an adapter;
- test single-provider configurations as well as multi-provider opt-in;
- do not log API keys, hidden reasoning, or unrelated repository content.

New optimization strategies must report their full cost, define a stopping condition, and demonstrate quality with repeatable evaluation evidence.

Good first contributions include deterministic graders, sanitized benchmark fixtures, provider price importers, report formats, project detectors, and documentation for a reproducible workflow.
