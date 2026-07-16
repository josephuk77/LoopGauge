# LoopGauge benchmarks

[English](README.md) | [한국어](README.ko.md)

Benchmarks exist to test one claim: a cheaper policy can meet a defined quality floor at a lower total cost per successful task.

The repository currently includes an API-free synthetic replay for onboarding. It demonstrates report semantics only and is not evidence of real model performance or savings.

```bash
npm install
npm run demo
npm run demo -- --json
```

Real benchmark contributions must follow [the methodology](../docs/benchmark-methodology.md) and publish sanitized raw observations whenever licensing and privacy allow.
