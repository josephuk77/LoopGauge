# Contributing to LoopGauge

LoopGauge welcomes focused issues and pull requests around provider adapters, deterministic graders, price-catalog importers, and reproducible loop strategies.

Before submitting a change:

```bash
npm install
npm run typecheck
npm test
npm run build
```

Provider neutrality is a hard invariant:

- never add a default company or model recommendation to the core;
- never call a provider or model outside the project allowlist;
- keep provider-specific behavior behind an adapter;
- test single-provider configurations as well as multi-provider opt-in;
- do not log API keys, hidden reasoning, or unrelated repository content.

New optimization strategies must report their full cost, define a stopping condition, and demonstrate quality with repeatable evaluation evidence.
