# Coverage: retention

| Source | Documented behaviour | Journey | Check |
|---|---|---|---|
| docs/4.usage/4.settings.md (Retention) | Data is pruned every hour | `the-hourly-prune-deletes-what-the-retention-passed` | logs older than the log retention and statistics days older than the statistics retention are deleted at the turn of the hour, newer ones are kept |
| docs/4.usage/4.settings.md (Retention) | Lowering a retention shows how much the next prune deletes and asks you to confirm it | `lowering-a-retention-tells-what-the-next-prune-deletes`; `lowering-a-retention-asks-before-it-deletes` | the impact route's exact days and requests for 30, 60, 90 and 366 days, refusals of an unknown field, 0 and 367; the sentence under the field, the `Delete stored data?` dialog with `30 → 7 days` and `≈ 3 requests`, Cancel keeps 30, Save and delete writes 7 |
