# WesBot dataset v2 integration

This directory stores the reviewed v2 package as evaluation and controlled seed input. It is not a runtime answer table, a source of live stock, or authorization to run SQL from the source ZIP.

## Boundaries

- `upstream/wesbot_semantic_intents_v2.jsonl` is semantic training/regression input.
- `upstream/wesbot_semantic_eval_holdout_v2.jsonl` is the immutable semantic holdout.
- `upstream/wesbot_intents_balanced.jsonl` is a regression subset of the legacy detector data and is not an independent evaluation split.
- `upstream/wesbot_future_extensions.jsonl` and `upstream/wesbot_hard_cases.jsonl` are product backlog/evaluation inputs. Their labels are not automatically added to the nine-intent student classifier.
- FAQ and alias JSON files may be consumed only by the guarded importer. New FAQ content must remain unpublished until reviewed.

Live price, inventory, SKU availability, reservations, payments, receipts, pickup windows, and account ownership always come from authenticated backend services. Model output never selects another student identity.

Run `npm run wesbot:dataset:validate` before evaluation or deployment. The
semantic evaluator is allowed to make at most 300 calls and currently attempts
81 dataset-only cases. Promotion gates are holdout macro-F1 at least 0.85,
per-intent recall at least 0.80, clarification accuracy at least 0.90,
multiturn intent-without-unnecessary-clarification at least 0.85, and acceptable
Preview p95 latency. Keep production semantic routing off until those gates are
measured and passed.
