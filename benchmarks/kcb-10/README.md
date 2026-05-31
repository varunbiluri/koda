# KCB-10 — Koda Context Benchmark

Ten fixed tasks measuring **KEI**, success rate, median tokens, and **% tool output via references**.

## Run

```bash
pnpm benchmark:kcb10          # mock scoring (no API key required)
pnpm benchmark:kcb10 --mock   # explicit mock mode
```

Output: JSON scorecard + append to `leaderboard.json`.

## Metrics

| Field | Description |
|-------|-------------|
| `kei` | `100 × (baseline_median / koda_median)` |
| `medianRefRate` | `% tool output via references` |
| `successRate` | Tasks completed successfully |
| `medianTokens` | Median prompt + completion tokens per task |

## Baseline

Default baseline median: **52,000 tokens** (session-based agent estimate). Override via scorecard input when live runs are available.
