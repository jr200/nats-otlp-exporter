# Benchmarks

Performance regression suite for this library. Run with `pnpm bench` (human output) or `pnpm bench:compare` (JSON + baseline comparison).

## Workflow

```sh
pnpm bench              # single run, human table (fastest)
pnpm bench:json         # single run, write bench/current.json
pnpm bench:best         # best-of-3, write bench/current.json (lower noise)
pnpm bench:compare      # best-of-3 + compare to bench/baseline.json (fails on regression)
pnpm bench:update       # best-of-3 + overwrite baseline.json with normalized output
```

## Baseline file: `bench/baseline.json`

Committed to the repo. Stores the reference `hz` (ops/sec) for every benchmark, normalized (absolute paths stripped, volatile fields dropped).

**To reset the baseline**: delete the file and push. CI will bootstrap a new one (uploaded as a `bench-baseline` artifact) which you can download and commit. Or regenerate locally with `pnpm bench:update`.

**To update the baseline after a deliberate perf change**: run `pnpm bench:update` and commit the new file. Do this on the same kind of machine the CI runs on (CI = `ubuntu-latest`, so ideally regenerate via a manual workflow run).

## Reducing noise

Three techniques applied to make comparisons reliable:

1. **Single-fork vitest** — `vitest.bench.config.ts` uses `pool: 'forks', poolOptions.forks.singleFork: true` plus `fileParallelism: false`. All benchmarks run in one process, serially. No JIT warm-up spread across workers, no file-level parallelism competing for cores.
2. **Best-of-3** — `pnpm bench:best` runs the suite 3 times in separate processes and keeps the highest `hz` per benchmark. This discards outliers where the runner got preempted.
3. **CI pinning** — on `ubuntu-latest` the workflow runs `nice -n -10 taskset -c 0,1 pnpm bench:compare`, raising priority and pinning to cores 0 + 1. Falls back to unpinned if `taskset`/`nice` aren't available (macOS).

Together these take bench-over-bench variance from ±80% (busy dev laptop) down to under ±5% in most cases.

**macOS note:** `taskset` was removed from macOS, so there's no CPU-core pinning equivalent. `taskpolicy -c background pnpm bench:best` is the closest approximation but may actually slow things down. Rely on CI for binding regression checks on macOS dev machines.

## Thresholds

Comparisons apply two thresholds to each benchmark's `hz` delta:

| Δ (current vs baseline)          | Outcome                             |
| -------------------------------- | ----------------------------------- |
| ≥ 10% slower, above combined RME | ⚠️ warn (GitHub Actions annotation) |
| ≥ 50% slower, above combined RME | ❌ fail (job exit 1)                |
| Within combined RME              | ≈ noisy (reported, not enforced)    |

Override via env vars:

```sh
WARN_THRESHOLD=15 FAIL_THRESHOLD=75 pnpm bench:compare
```

### Noise handling

Each benchmark ships with a **Relative Margin of Error (RME)**. The comparison computes `noise = sqrt(baseline.rme² + current.rme²)` and only flags a regression if it exceeds that combined noise floor. This avoids false positives on high-variance benchmarks and under-loaded runners.

## CI integration — composite action

The run/normalize/compare scripts live in **`.github/actions/bench/`** as a GitHub composite action. Consumer workflows invoke it in one step:

```yaml
- uses: actions/checkout@v4
- uses: pnpm/action-setup@v4
  with: { version: 10 }
- uses: actions/setup-node@v4
  with: { node-version: 22, cache: pnpm }
- run: pnpm install --frozen-lockfile
- uses: ./.github/actions/bench
  with:
    warn-threshold: '10'
    fail-threshold: '50'
```

### Promoting to the shared templates repo

To share this across repos, move `.github/actions/bench/` verbatim into `jr200/github-action-templates/.github/actions/bench/`, then update consumer workflows:

```yaml
- uses: jr200/github-action-templates/.github/actions/bench@main
  with:
    warn-threshold: '10'
    fail-threshold: '50'
```

That's the entire migration. Consumer repos then need only:

- `bench/*.bench.ts` files
- `bench/baseline.json` (committed)
- `vitest.bench.config.ts`
- Vitest as a devDep (already present for other tests)

The action handles everything: best-of-N runs, CPU pinning, bootstrap-if-missing-baseline, compare + GitHub annotations + artifact upload.

### Composite action inputs

| input                     | default                  | description                                  |
| ------------------------- | ------------------------ | -------------------------------------------- |
| `vitest-config`           | `vitest.bench.config.ts` | bench vitest config path                     |
| `baseline-path`           | `bench/baseline.json`    | committed baseline                           |
| `current-path`            | `bench/current.json`     | output of current run                        |
| `runs`                    | `3`                      | best-of-N                                    |
| `warn-threshold`          | `10`                     | % slowdown → warning                         |
| `fail-threshold`          | `50`                     | % slowdown → job failure                     |
| `pin-cpu`                 | `true`                   | `taskset -c 0,1 && nice -n -10` on Linux     |
| `bootstrap-if-missing`    | `true`                   | upload artifact when no baseline, don't fail |
| `bootstrap-artifact-name` | `bench-baseline`         | name for bootstrap artifact                  |

The `if: hashFiles('bench/**/*.bench.ts') != ''` guard in the workflow means the job is skipped automatically for repos that haven't added benchmarks.

## Files

```
bench/
  baseline.json          committed; comparison reference
  current.json           generated, gitignored
  *.bench.ts             the benchmarks themselves
  runBest.mjs            best-of-N runner (local dev)
  normalizeBench.mjs     strips abs paths + volatile fields (local dev)
  compareBench.mjs       compares + emits GH annotations (local dev)
  README.md              this file
```

The three `.mjs` scripts are duplicated in `jr200/github-action-templates/.github/actions/bench/` where they power the composite action used by CI. Keep them in sync when making changes.
