# Fuzzy Matching Performance

RobotTS includes repeatable synthetic benchmarks for watched catalogs and direct fuzzy searches. The fixtures use deterministic high-entropy pixels and verify the expected match after every measured search.

Run them from a source checkout after building the native addon:

```bash
npm run benchmark:fuzzy-catalog -- --threads=1,2,4,8,auto
npm run benchmark:fuzzy-direct -- --threads=1,2,4,8,auto
```

Add `--full` to the catalog benchmark for its full-HD, 50-image case. Results are emitted as newline-delimited JSON so they can be retained and compared mechanically.

## Reference Result

The following catalog result was measured on an Intel Core i7-14700KF with 28 logical CPUs available to the process, using Node.js 26.4.0:

| Implementation | Threads | Median native time |
| --- | ---: | ---: |
| Previous catalog matcher | 1 | 590 ms |
| Optimized catalog matcher | 1 | 246 ms |
| Optimized catalog matcher | 2 | 129 ms |
| Optimized catalog matcher | 4 | 69 ms |
| Optimized catalog matcher | 8 | 44 ms |

The fixture is a 960 x 540 source, sixteen 24 x 24 references, a `0.9` threshold, `0.08` tolerance, and exhaustive `candidate_step: 1`. On this workload, the optimized eight-thread path is approximately 13 times faster than the previous implementation.

The optimized matcher reduced indexed fingerprints from 2,960 to 1,424 while retaining a deterministic 32-signal evidence target. Measured fingerprint collision checks fell from 83.8 million to 39.7 million. Candidate generation, accepted occurrence count, verification count, and final score remained unchanged.

Direct fuzzy search over a 960 x 540 source and one 32 x 32 reference measured approximately 283 ms with one thread and 98 ms with eight threads. Direct search remains exhaustive over candidate offsets; its scaling is limited by per-candidate scoring and pruning.

These figures are a comparison aid, not a platform guarantee. Capture composition, reference entropy, thresholds, tolerance, partial matching, CPU topology, thermal state, and concurrent workloads can materially change results.

## Interpreting Metrics

Catalog events expose enough work and timing data to locate the dominant phase:

- `capture_ms`, `bitmap_copy_ms`, `queue_ms`, and `thread_budget_wait_ms` cover work outside candidate evaluation.
- `candidate_scan_ms`, `candidate_extraction_ms`, and `verification_ms` separate index traversal, qualified-offset construction, and full scoring.
- `fingerprint_collisions_tested`, `candidate_votes_recorded`, `candidate_offsets_generated`, `candidate_offsets_verified`, and `verification_pixels_compared` show algorithmic work.
- `evidence_cells_initialized`, `evidence_cells_examined`, and `workspace_bytes` show candidate-workspace behavior.
- `requested_thread_count`, `available_thread_count`, and `effective_thread_count` explain scheduling decisions.

Direct fuzzy results expose the corresponding candidate, scheduling, scan, verification, and elapsed metrics through `result.metrics`.
