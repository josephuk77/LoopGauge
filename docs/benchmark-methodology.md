# Benchmark methodology

[English](benchmark-methodology.md) | [한국어](benchmark-methodology.ko.md)

LoopGauge optimizes cost under a quality constraint. A benchmark is credible only when the task distribution, graders, costs, and stopping rules are defined before inspecting the final holdout results.

## Evidence levels

1. **Unit tests** verify implementation correctness, provider isolation, scoring, and accounting.
2. **Synthetic replay** demonstrates report behavior without claiming model performance.
3. **Public live benchmark** measures provider calls on a licensed, reproducible task set.
4. **Private shadow pilot** measures a real workflow without sending candidate output to customers.

Reports must state their evidence level prominently.

## Dataset split

- Use representative tasks rather than hand-picked easy examples.
- Keep prompt/harness development tasks separate from a held-out evaluation set.
- Record exclusions and failures instead of silently dropping them.
- Use multiple repetitions when model variance can change the decision.
- Publish dataset licensing and sanitization rules.

## Quality definition

Define before running:

- mandatory failure conditions;
- deterministic tests and graders;
- rubric weights;
- human review protocol for subjective output;
- baseline model and snapshot;
- minimum baseline ratio;
- whether similarity is a report metric or an eligibility gate.

Do not rely on the teacher model as the only judge. Combine deterministic checks, blinded human review, or an independently justified grader.

## Cost definition

Use cost per successful or approved task, not cost per API call.

```text
total cost = input + output + cache + tools + retries + judge + escalation + failed work
cost per success = total policy cost / successful tasks
```

For business workflows, report human correction time separately or convert it with a disclosed hourly rate. Record the provider price-catalog timestamp in every report.

## Search and stopping

Pre-register:

- optimization budget;
- per-call and per-task budget;
- maximum iterations;
- no-improvement limit;
- cancellation behavior;
- promotion and fallback policy.

Never spend beyond a declared bound merely to improve a public result.

## Minimum public report

- exact command and LoopGauge commit;
- project/task versions;
- model IDs and price timestamp;
- sample count and repetitions;
- baseline quality and cost;
- every candidate's success rate, quality, difference, and total cost;
- optimization cost and amortized savings;
- break-even task count;
- raw sanitized JSON or JSONL evidence;
- limitations, conflicts, and negative results.
