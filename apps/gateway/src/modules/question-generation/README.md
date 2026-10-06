# Question Generation Tools

This is the first implementation step: fixed task-scoped tools and persistence.
It does not replace the current coach, seed-based practice UI, or start a model run.

## Host Integration

The host creates one tool set per task with `createQuestionGenerationTools`:

- Inject `SqliteQuestionGenerationRepository` with the host-owned SQLite connection.
  The normal schema initializer applies migrations v044/v045. Do not open a second connection
  or run migrations inside a model tool.
- Supply a trusted `{ taskId, userId, sessionId, turnId }` binding and a future expiration.
  The runtime must own these identities; model input cannot override them.
- Freeze language, target level, model, prompt version, permitted answer formats,
  category limits, total question limit, audio asset/call limits, paper limits,
  permitted textbook chapters and existing user-selected voices in `GenerationConfig`.
- Inject `createGenerationTtsRenderer(provider, apiKey)` with the host-selected provider
  and credentials. Keys never enter the config, dynamic prompt, or tool arguments.
  Use a provider with actual two-speaker synthesis for dialogue; never substitute voices
  or fall back silently. Native dialogue is enabled by default only for the installed
  Gemini provider; other providers require a host-declared, tested `supportsDialogue`
  capability (the installed Azure/local providers are single-voice only).
  The installed TTS provider receives an `AbortSignal` and must
  stop its underlying request on cancellation.
- Give only `registry.list()` to the dedicated generation agent and add `dynamicPrompt()`
  to its system instructions. Never merge this registry into the coach registry.
- Execute calls through `registry.execute(name, arguments, trustedContext)`.
  Always await `dispose('COMPLETED')` after successful generation, or `dispose()` in the
  cancellation/error path. Disposal waits for audio cleanup before closing the task.
  One host runner owns the tool set; it must not start overlapping owners for a task.

No new endpoint or credential provisioning is enabled in this step. The next step is
the dedicated model runner and UI configuration, using these contracts unchanged.

## Fixed Tools

| Tool | Responsibility |
| --- | --- |
| `generation.config` | Frozen config plus consumed question/audio-call/audio-asset/paper quotas |
| `generation.textbook` | Owned, authorized chapter vocabulary, knowledge, articles, sentences, exercises or material |
| `generation.pool` | Eligible questions by category/answer format; existing per-user answered/mistake markers |
| `generation.submit` | Validate and atomically persist up to 20 question drafts; return stable question/material IDs |
| `generation.audio` | Synthesize and persist dialogue, passage or news audio with the frozen voices |
| `generation.paper` | Ordered mixed-paper snapshot from eligible IDs; listening requires ready audio |

The six learning categories and six answer formats are independent. Listening may use
choice, fill-blank or short-answer questions; dialogue/passage/news describe its shared
material, not its answer format. Dialogue uses explicit `MALE`/`FEMALE` turns. Passage
and news use `NARRATOR`. News must declare simulation or source URL/publication time;
source metadata is a model claim, not a completed fact-check.

Japanese levels use N5–N1, English CEFR A1–C2, Korean TOPIK_1–TOPIK_6. These are **target
levels**, not a claim that every format is an official exam question. Stored difficulty
is `AI_ESTIMATE` with a reason. `VALIDATED` means structural/config validation only,
not pedagogical certification. Skill IDs require the language prefix (for example
`en.grammar.present`). Semantic difficulty/content quality still needs a later review.

## Persistence And Limits

v044 creates a question identity table and separate choice/fill-blank/reorder/short-answer/
translation/writing detail tables. Reading and listening materials have separate tables.
Task state, receipts, question memberships, audio bytes and immutable paper snapshots
are persisted, not dependent on model conversation history.
v045 adds consumed audio-call counts and catalogs known legacy formats in their detail
tables. It upgrades desktops that already applied the earlier v044, without replacing
that migration or guessing legacy difficulty levels.

Question submission and assembly are immediate transactions. Same request key + same
payload replays the receipt; changed payload is rejected. Exact canonical duplicates
reuse question IDs. Total/per-category quotas count distinct task question identities;
paper size, paper count and per-category paper limits are also enforced. Failed batches
roll back materials, detail rows and receipts together.

Audio synthesis runs outside the database transaction. A claim reserves a slot before
calling the provider and rejects concurrent synthesis. Ready audio is reused. Failures
release the asset reservation, but **service-call attempts remain consumed** to bound
retry costs. Empty/invalid/oversized results, expired tasks and cancelled calls cannot
commit ready audio. Limits are 12,000 script characters and 25 MiB per audio asset.
Provider MIME parameters are retained (including Gemini PCM codec and sample rate);
the future playback consumer must use the existing PCM-aware audio path, not treat
raw PCM as a WAV file.
Task timeout/cancellation depends on the provider honoring the abort contract; a
non-cooperative provider is not treated as successfully cancelled.

Existing `quiz_questions`, `quiz_attempts` and `mistakes` remain unchanged. Known legacy
formats are cataloged in their respective detail tables, retaining original raw values
even if JSON is malformed. They remain `LEGACY_PENDING`/`LEGACY_UNKNOWN`: no N5/A1
level is guessed and they are excluded from the new eligible pool. Unknown formats keep
their raw data under `LEGACY`. Seeds inserted after migration still use their existing
legacy path. This is not a wholesale retirement of old tables.

Answer/mistake filters read the existing user/language-scoped history tables. Tool tests
seed this history to verify isolation; **the new bank/paper UI and answer-submission
integration are not implemented yet**. Do not claim a question is completed merely
because it was generated or assembled. Subjective formats require a later grading path.

Migration is registered for normal startup. This change does not explicitly migrate a
real learner database or restart the user's gateway. Verify a backup and apply it through
normal startup before enabling the new generator in production.

## Verification

From the repository root:

```powershell
bun test apps/gateway/src/__tests__/question-generation.integration.test.ts apps/gateway/src/__tests__/question-generation-audio.integration.test.ts apps/gateway/src/__tests__/question-generation-textbook.integration.test.ts packages/storage-sqlite/src/__tests__/question-generation-migration.integration.test.ts
bun run typecheck
bun run test:all
```

Tests use real in-memory/temporary SQLite and simulated providers, including six answer
formats, three listening modes, speaker mapping, quota exhaustion, atomic rollback,
ownership/level restrictions, idempotency, mixed papers, existing history, audio failure,
timeout and cancellation, v43/v44 migration, file reopening and failed-migration retry.
No paid model/TTS call is part of this test suite. Real-provider sound quality,
model tool selection, installed desktop delivery and UI behavior are not verified here.
