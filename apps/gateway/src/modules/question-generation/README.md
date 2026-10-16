# Question Generation Tools

This is the first implementation step: fixed task-scoped tools and persistence.
It does not replace the current coach, seed-based practice UI, or start a model run.

## Host Integration

The host creates one tool set per task with `createQuestionGenerationTools`:

- Inject `SqliteQuestionGenerationRepository` with the host-owned SQLite connection.
  The normal schema initializer applies migrations v044 through v048. Do not open a second connection
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

## P1 Dedicated Runner And Host Task Service

- `service.ts` (`GenerationTaskService`) owns host task identity: `createTask` validates
  `CreateGenerationTaskSchema`, checks the exact blueprint against frozen max quotas and
  persists blueprint/runLimits/objective via v046 columns. `queryTask`/`cancelTask`/paper/audio
  reads verify ownership (`userId` + `taskId`) and remain readable after `COMPLETED`/`CANCELLED`.
  One in-memory owner per task rejects concurrent runs; restart orphans are terminated with
  `recoverOrphanedTasks` (cleans `RUNNING` audio placeholders, never replays paid synthesis).
- `run-manager.ts` (`GenerationRunManager`, wired in `bootstrap/create-gateway.ts` with one
  `AcpAdapter` per task) is the only production entry into `runGenerationTask`: `POST
  …/tasks/:userId/:taskId/run` returns 202 and runs the full loop in the background,
  `GET …/run-state` reports progress. P5 production audio resolves via
  `infrastructure/resolve-audio.ts` from host env only (`GEMINI_API_KEY`/`GOOGLE_API_KEY`,
  `AZURE_TTS_KEY`, `STUDY_STUDIO_ENABLE_LOCAL_TTS=1` for local); unconfigured providers
  return undefined and the audio step fails honestly with `E_AUDIO_UNAVAILABLE`.
  Keys never enter config, prompts, tool args or logs.
- `runner.ts` (`runGenerationTask`) drives one isolated model session per task through the
  public `AgentAdapter`/`AgentSession` interface: only the six generation tools (per-run
  unique-name clones registered for the run, unregistered after), no `workingDirectory`,
  `approvalPolicy: 'never'` (own pre-authorized tools run straight through; engine-native
  actions have no ACP sandbox counterpart, see file header), `ephemeral: true`, and the frozen
  `config.modelId` (caller overrides are not accepted). Tool calls execute with the trusted
  host binding (engine session `gen:<taskId>` mapped by `userId`), non-whitelist names are
  rejected before touching the registry, and model rounds/failed repairs/wall time are bounded
  by `GenerationRunLimits` across the whole lifecycle (timer starts at owner acquisition;
  exhaustion aborts the model session and reports the quota error, not generic cancellation).
  Cancellation aborts the model and disposes the tool set immediately, so the TTS provider
  observes the abort and no audio is persisted afterwards. Success is decided by persisted
  assets (latest paper exists, exact blueprint verified, listening audio `READY`); a model
  claiming completion without assets fails with `E_GENERATION_INCOMPLETE` and the task is
  left `CANCELLED`, never reported success. Engine-native actions have no ACP sandbox
  counterpart (sessions run with `approvalPolicy: 'never'`; only the six allowlisted
  tools execute via the registry); residual risk is documented here rather than hidden.
- `system-prompt.ts` is the single code owner of the fixed system rules (mirrors
  `docs/ai-pipelines/question-generation-runtime-prompt.md`); `blueprint.ts` enforces
  max-quota fit at creation and exact paper verification at completion; the exact blueprint
  and run budget are also injected into `dynamicPrompt()` and `generation.config` as host
  facts so the model plans against the real acceptance criteria. `student-view.ts` strips
  correct answers, reference answers, explanations, rubrics and listening transcripts.
- HTTP (`http/generation-routes.ts`, mounted in `transport/http/create-app.ts`) exposes only
  create/query/cancel/recover, background-run dispatch, student-only paper reads (no host
  full-answer reader; review-stage release arrives with the P2 practice loop) and audio bytes
  with MIME. Model driving is never triggered synchronously over HTTP.

## P2 Answer Loop Into The Shared Practice Records

- `practice/persistence/bank-answer.ts` answers bank papers through snapshots: objective
  MC/FILL/REORDER normalized (`normalizeBankObjective`) into the shared `gradeObjectiveAnswer`
  owner (same key/text, variants and join rules, no similarity invention). Subjective answer
  retention is owned by `practice/persistence/bank-subjective-answer.ts`, with both paths
  using `prepareBankSubmission` from `bank-submission.ts` for the shared identity ledger.
  SHORT may use deterministic exact-match; TRANSLATION/WRITING always require explicit
  rubric grading, even when the answer equals the sample.
- Recording reuses the single `submitPracticeAttempt` owner into the same `quiz_attempts`,
  skill-metric and `mistakes` tables: no second history source, no rows in `quiz_questions`.
  Submission identity mirrors the objective path (`att_<len>:<user>:<submissionId>`); changed
  content, paper context or elapsed time on a reused key is `E_SUBMISSION_CONFLICT`.
  Both answer routes reserve the same submission identity. Legacy record paths reject
  validated bank questions without a host-settled receipt; legacy pending questions
  remain usable through the established legacy workflow.
- Answer retention commits before subjective grading. v048 preserves elapsed time,
  attempt identity, model/adapter and structured grading feedback. Failed grade commits
  roll back grade + learning facts, then save `GRADING_FAILED` without losing the answer.
  A validated model receipt is retained privately on a failed statistics commit;
  retrying the same model configuration reuses it instead of paying for another run.
- Explicit grading/retry: `POST /api/generation/tasks/:userId/:taskId/papers/:paperId/answers/subjective/:submissionId/grade`
  accepts optional `model`/`effort`, not scores or reference answers. Omitted model uses
  the task's frozen model. Saving an answer does not implicitly call a paid model.
  `BankGrading` reuses `TextbookGrading` and the turn-bound `learning.submit_grade` tool;
  model prose, invalid receipts and client scores cannot become grades. Writing word
  limits use `Intl.Segmenter` word-like segments and are checked before model execution
  and before persistence. A normalized score >= 0.8 is correct; raw rubric scores and
  feedback are retained. Concurrent identical requests share one execution; graded
  requests replay without another model call. Real model verification remains P5.
- Review release is server-computed from matching settled submissions + `quiz_attempts` (`bankAnswerStates`):
  `readReviewPaper` + `?view=review` reveal full snapshots only for answered items.

## P4 Preset Resolution And Suggestions

- `presets.ts` resolves the versioned catalogue into a validated blueprint, frozen quotas
  and matching task objective. The unchanged comprehensive baseline reuses the quick
  preset; adjusted counts or listening modes are never replaced with the baseline.
  Disabling listening removes default modes and audio requirements; explicitly nonzero
  modes with zero listening questions remain invalid. Writing counts are rejected when
  the preset excludes the required writing answer format, before starting a model.
- `GET /api/generation/suggest/:userId?language=...` uses the selected track first, then
  the existing profile, then a visible English default. Level, mistake signals and owned
  document counts all refer to that same language. Suggestions do not initialize profiles
  or language rows; failed fact reads are reported, not represented as an absence of mistakes.
  Recommendations remain optional and levels are defaults, not proficiency estimates.
- Submission identities retain a full random UUID, with the saved identity and duration
  reused on retries. Controlled UI tests include a response lost after the database commit,
  not merely a request rejected before reaching the server. Production model/TTS and
  installed Tauri verification remain separate delivery checks.

## P5 Production Wiring And Remaining Live Verification

- Audio: `resolveGenerationAudio(config, env)` is the single host owner. No paid call is
  made by tests or by wiring itself; real synthesis only happens when a user-authorized
  run executes `generation.audio` with a configured provider key.
- Migrations v044–v048 verified contiguous on a memory DB (`max schema_migrations = 48`);
  no real learner DB was touched. Desktop bundle contract (`apps/desktop/src-tauri/tauri.conf.json`,
  LexDistill 0.1.2, gateway sidecar + web dist) is present; on-device run, small-quota
  real model/TTS, and clean-install delivery remain **unverified** pending the user's
  service selection, explicit quota authorization, and backup path confirmation
  (`docs/db-backup-recovery.md`). Controlled tests, real-service runs, desktop checks and
  install delivery must be reported separately.

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
