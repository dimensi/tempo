# Local browser performance

Historical measurements below describe the suites/code of their recorded revisions, not current product acceptance requirements. The family name Offline does not require cold boot, a shell or synchronous conceal. New client-read behavior follows [ADR 002](../decisions/002-resilient-client-reads.md); runtime tests now cover network resilience and retirement of the former Service Worker. Retain genuine server authorization, write integrity and runner-isolation checks.

Owned scope: browser orchestration, disposable test fixtures, process cleanup,
profiling and four scenario login helpers. No production modules, contracts,
database schema, dependencies, workflows or deployment policies change.

For mandatory pre-merge checks use `pnpm verify:merge` (entrypoint
`scripts/verify-merge.mjs`). It builds once and runs the complete General,
nutrition-sync and TransformMate suites with isolated workers, rejecting any
skipped, omitted, retried or failed case. The command records the committed SHA,
build ID, counts and durations in `test-results/merge-verification.json` and
never merges or deploys. It requires a clean committed working tree and defaults
to four workers; `pnpm verify:merge 2` explicitly selects two. Workers select free
dedicated loopback gateway/backend/provider groups, without stopping other tasks.
Temporary worker directories are deleted, not archived. Authentication, real
rate-limit checks and all desktop/mobile assertions remain enabled.

The commands below are only historical performance measurement tools, not the
pre-merge gate (they select Offline instead of nutrition-sync).
Build once with `pnpm build`, then measure on macOS or Linux:

```sh
node scripts/ci/measure-e2e.mjs 2 two-workers
node scripts/ci/measure-e2e.mjs 4 four-workers-1
node scripts/ci/measure-e2e.mjs 4 four-workers-2
node scripts/ci/measure-e2e.mjs 4 four-workers-3
```

Labels are unique; run measurements sequentially. The command runs the unchanged
General, Offline and TransformMate scenario selection, with desktop and iPhone 13
Chromium variants. Reports go to `test-results/benchmarks/<label>`; keep the JSON
reports and failure traces when investigating a regression. This opt-in local
command does not change automatic CI/CD, the CI family plan or its default
concurrency. PR #97 remains intact.

## Guarantees

- At most four worker sandboxes, independent gateway/backend/upstream ports,
  SQLite files, uploads/token stores, Next processes and browser contexts.
- Every worker receives scenarios from both viewports. Scenario variants stay
  together, so title selection cannot accidentally select an unassigned viewport.
- Enumerated file/line/title/project keys must exactly match executed results.
  A start ledger must include a unique reset for every non-skipped case.
- No automatic retries, new skips, reduced assertions or security bypasses.
  Existing mobile diagnostic skips have exact file/title/project allowlists.
- Before each case the old Next process exits; the closed SQLite fixture is
  restored, private files are deleted, synthetic provider state is recreated and
  the Next filesystem is restored before a new process becomes ready.
- Every file in `.next/server` is hashed, even if its size/mtime did not change.
  Missing/changed bytes, modes and links are restored from a private pristine
  snapshot; extra entries are removed. Unchanged files stay in place. No writable
  hard links or shared server trees connect workers. `.next/cache` is deleted.
- macOS cleanup uses a random inherited process ownership token, including
  detached/orphaned children. Process birth time and token are checked before
  signalling. It never selects unrelated processes by executable name or port.
  Linux retains its kernel child subreaper. Neither mechanism handles a host
  crash or uncatchable SIGKILL of the supervisor.
- Real HTTP auth fixtures are scoped to each fresh case/context. They assert the
  response, session email/role and authenticated navigation. They never mint fake
  cookies or reuse sessions across SQLite resets. Login-form/security and genuine
  throttling scenarios keep their existing real login paths and assertions.

## Profiling

Reset samples contain only milliseconds for stop, SQLite, private filesystem,
Next restoration, start/readiness and total. Aggregation reports sample count,
nearest-rank p50/p95 and sum per phase. It contains no session, credential,
user ID, database rows or uploaded content. Per-test statuses and durations remain
in the browser reports independently of this timing summary.

The initial macOS samples identified full `.next/server` delete/copy as expensive
(about 360 ms versus about 0.5 ms for SQLite). A five-iteration isolated filesystem
probe measured full copy at 320–460 ms and byte-checked restoration at 47–93 ms.
The obsolete 11-second cross-test auth-quota sleep in diary-refresh was removed;
its server already starts fresh before the case. Intentional debounce/race waits
and the real server-directed throttling delay remain.

## Measurements

Measured natively on 2026-10-15: macOS 26.6.2, Apple M3 Pro (12 cores),
36 GiB RAM, Node 22.23.3, pnpm 9.15.4, pinned Chromium/Playwright 1.64.
All runs were sequential on this Mac, with no concurrent benchmark runs.

Application Git SHA: `cdadbe3bb5da6b528ea3edf80663147266efd5f7`.
Every timed run used the identical prebuilt standalone artifact,
BUILD_ID `vk20LTEv5htSED1G-pxTn`. Both worktrees had that HEAD; the optimized
worktree contained this PR's uncommitted test-only changes. Production source,
configuration and dependencies were unchanged. The baseline used the original
harness (two viewport workers for General, serial Offline/TransformMate), with
only macOS process cleanup, passive reset instrumentation and the same two
visible-element locator corrections applied to both variants. Original UI login
helpers and the 11-second diary-refresh sleep remained in the baseline.

The supplied historical 86/45/15-test times are retained as context, not used in
these speedup ratios: this revision has 95/45/15 passing cases. The updated
General selection includes additional cases. Timing ratios below compare the
same scenarios and viewports on the same Mac and build.

| Run | General, s | Offline, s | TransformMate, s | Total, s | Speedup | Next starts |
| --- | ---------: | ---------: | ---------------: | -------: | ------: | ----------: |

| Baseline | 215.222 | 90.627 | 96.221 | 402.070 | 1.00x | 104 |
| two-workers | 160.662 | 43.269 | 25.127 | 229.058 | 1.76x | 168 |
| four-workers-1 | 121.564 | 29.831 | 20.086 | 171.481 | 2.34x | 174 |
| four-workers-2 | 117.279 | 29.360 | 21.272 | 167.911 | 2.39x | 174 |
| four-workers-3 | 142.088 | 30.853 | 19.237 | 192.178 | 2.09x | 174 |

Median of the three 4-worker totals: **171.481 s**, **2.34x faster** (57.4% less
wall time) than 402.070 s. Observed range: 167.911–192.178 s; the slowest repeat
was still 2.09x faster. This is a local wall-time measurement, not a CI-host
performance promise. The 4-worker tail latency varied; it is not hidden by
reporting only the best run.

Starts increase because Offline and TransformMate now also receive a fresh
process and SQLite snapshot for **every case**, including runtime diagnostic
skips, rather than sharing one process through a family. General has 100 resets,
Offline 46 and TransformMate 16; each family adds one initial readiness process
per worker. Hence 168 starts with two workers and 174 with four. The supplied
113 starts referred to a full browser regression; the 104 baseline here covers
only the three timed families and must not be compared directly to that number.
Other CI families are not included in the timed denominator.

### Coverage conservation

The comparison command passed for all four optimized runs. It asserts identical
application revision and build ID and exact file/title/project/status identity,
rejects duplicate identities, failures and flaky results. Line numbers can move
when login helpers are extracted; each individual harness run still checks the
full enumerated file/line/title/project identity against execution.

| Family        | Desktop selected | Mobile selected | Passed | Existing mobile skips |
| ------------- | ---------------: | --------------: | -----: | --------------------: |
| General       |               50 |              50 |     95 |                     5 |
| Offline       |               23 |              23 |     45 |                     1 |
| TransformMate |                8 |               8 |     15 |                     1 |
| Total         |               81 |              81 |    155 |                     7 |

All three 4-worker repetitions and the 2-worker run have **zero failed, zero
flaky and zero new skipped cases**, with Playwright retries still zero. The
baseline initially exposed two pre-existing selectors matching retained hidden
Next page DOM in `diary.spec.ts`; both selectors now require the visible element
and retain the same href/empty-state assertions. Those corrections were applied
to both measurement variants before collecting the successful baseline.

### Reset times

Milliseconds, nearest-rank percentiles. Baseline serial provider families did
not perform per-case production resets, so no reset quantile exists for them.

| Run            | Family        | Samples | Total p50 | Total p95 | Next restoration p50 | Next restoration p95 |
| -------------- | ------------- | ------: | --------: | --------: | -------------------: | -------------------: |
| Baseline       | General       |     100 |   699.565 |   825.733 |              330.756 |              387.688 |
| two-workers    | general       |     100 |   441.343 |   647.446 |               64.074 |               92.720 |
| two-workers    | offline       |      46 |   437.881 |   495.522 |               64.442 |              105.940 |
| two-workers    | transformmate |      16 |   433.738 |   526.558 |               65.003 |              167.610 |
| four-workers-1 | general       |     100 |   515.174 |   996.353 |               72.306 |              133.165 |
| four-workers-1 | offline       |      46 |   533.367 |   623.471 |               79.967 |              146.356 |
| four-workers-1 | transformmate |      16 |   490.423 |   583.724 |               75.838 |              169.976 |
| four-workers-2 | general       |     100 |   484.381 |   758.189 |               70.527 |              124.724 |
| four-workers-2 | offline       |      46 |   534.855 |   600.338 |               76.377 |              162.742 |
| four-workers-2 | transformmate |      16 |   503.294 |   607.080 |               78.683 |              132.348 |
| four-workers-3 | general       |     100 |   527.830 |  2196.969 |               74.736 |              174.274 |
| four-workers-3 | offline       |      46 |   527.827 |   652.118 |               74.112 |              119.344 |
| four-workers-3 | transformmate |      16 |   510.486 |   576.394 |               79.787 |              126.692 |

For the median 4-worker run, General reset phase breakdown:

| Phase      | Baseline p50 / p95, ms | Four workers p50 / p95, ms |
| ---------- | ---------------------: | -------------------------: |
| stop       |         8.210 / 12.542 |             9.601 / 42.848 |
| sqlite     |          0.468 / 0.775 |              0.482 / 1.330 |
| filesystem |          0.047 / 0.410 |              0.057 / 0.530 |
| next       |      330.756 / 387.688 |           72.306 / 133.165 |
| start      |      349.507 / 411.112 |          416.998 / 772.505 |
| total      |      699.565 / 825.733 |          515.174 / 996.353 |

Raw per-case reports and ledgers are retained locally in the ignored
`test-results/benchmarks/<label>` directories, not committed as test artifacts.
Aggregate tables above contain no personal data. Recheck coverage and timing with:

```sh
node scripts/ci/compare-benchmarks.mjs \
  test-results/benchmarks/baseline \
  test-results/benchmarks/two-workers \
  test-results/benchmarks/four-workers-1 \
  test-results/benchmarks/four-workers-2 \
  test-results/benchmarks/four-workers-3
```

## Final validation

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build`
  passed; unit/integration: 126 files, 1000 tests.
- Four complete optimized measured sets passed: one with 2 workers and three
  with 4. Exact coverage/build comparison passed for all four.
- Additional real isolation checks passed with 2 and 4 workers (4 cases each),
  including colliding SQLite/private paths and the genuine 31st-request HTTP 429.
  Production smoke passed all 6 desktop/mobile cases, no skips or retries.
- `node --test tests/ci/*.test.mjs`: all 42 remaining tests passed, no skips.
  The obsolete `tests/ci/workflow.test.mjs` policy snapshot was removed at the
  user's explicit request. CI/CD workflow files remain unchanged.
- Test-only files and documentation changed. No production code, migrations,
  dependency changes, workflow changes, merge or deployment.

The post-benchmark validation build generated a new build ID; the timed runs all
used the one original ID recorded above. Timing did not mix builds. The baseline
reports and local reproduction support patch were copied to
`test-results/benchmarks/baseline` before removing the disposable baseline
checkout. Worker sandboxes are removed by the harness after process cleanup.
