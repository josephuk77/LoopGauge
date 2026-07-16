# API-free synthetic replay

[English](README.md) | [한국어](README.ko.md)

This fixture demonstrates how LoopGauge rejects a cheap policy below the quality gate and selects a guarded policy using cost per approved task.

It makes zero provider API calls. All names, scores, costs, savings, and break-even values are synthetic. Do not cite them as measured model results.

```bash
npm run demo
```

Expected decision:

- reject `haiku-direct` despite its low price;
- accept `sonnet-verify` and `haiku-guarded` above the 95% quality floor;
- select `haiku-guarded` because its synthetic cost per approved task is lower;
- report a synthetic break-even point that includes optimization spend.
