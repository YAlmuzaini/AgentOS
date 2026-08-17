# External review artifacts

Verbatim output of the independent Claude Code reviews run against the capability-aware company
work, saved so a verdict can be checked rather than taken on trust.

Every round was invoked from the repository root with the installed CLI, non-interactive
(`claude -p`), `--effort high`, `--permission-mode plan`, and read-only tools only — `Read`, `Grep`,
`Glob`, and read-only `git diff` / `git status` / `git log`. Each was explicitly told to review and
not to modify. No repository file was modified by any round.

| File | Verdict | Headline |
|---|---|---|
| (round 1, previous session) | NO-GO | Not captured to a file at the time. Normalized findings are in `PROGRESS.md`. |
| `2026-08-17-round2.md` | NO-GO | The three round-1 Highs verified fixed; one new High — every goal specialist turn died on the handoff size cap and the loop retried it for ever |
| `2026-08-17-round3.md` | NO-GO | Handoff High fixed; one Critical — the same failure shape one call earlier, on the evaluator, spending metered tokens no rail counts |
| `2026-08-17-round4.md` | NO-GO | Critical and High fixed; three Mediums, including a dedupe that never matched because `jsonb` reorders object keys |
| `2026-08-17-round5.md` | NO-GO | One High — the round-4 busy-worker fix left the wait path with no counter at all, so a drained worker spun local goals for ever |
| `2026-08-17-round6.md` | **GO** | All remedies verified, loop bounded on every turn outcome; one Medium and five Lows, none blocking |

Round 6 returned GO. Its one Medium (a stop message promising a restart the product does not have)
and its Lows were fixed afterwards, so the tree is one step ahead of the last saved review.

These are a reviewer's claims, not established fact. Each finding was independently verified against
the code before being acted on; a few were narrower than described, and that is noted in
`PROGRESS.md` rather than silently corrected here.
