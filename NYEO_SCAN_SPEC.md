# NYEOCARE Scan Specification

**Purpose:** the authoritative scan-only engineering contract for turning photographed handwritten registers into trustworthy, reviewable person observations.
**Last updated:** 22 October 2026
**Implementation line:** v78 two-pass top-to-bottom ordering, standardized display names, and v77 partial-field extraction; default reasoning effort is `low` and reasoning output is hidden.
**Release rule:** a branch or passing test is not production proof. Production is confirmed only when the Vercel production deployment SHA matches the merged commit and a real scan completes safely.

## 1. Product contract

Scan is population/identity capture. It is **not attendance**, not a declaration that a person attended, and not permission to infer participation. A scanned page might be incomplete, historical, or from another program.

The system must:
- Transcribe what the current image visibly contains, not what is likely or familiar.
- Preserve a complete name—including honorifics, initials, punctuation, casing, all given/family-name parts, and unfamiliar Nigerian spellings.
- Extract names, phone numbers, and date of birth independently. **One readable field is enough to preserve a row for Review.** A phone-only or DOB-only row must not be dropped because the name is blank.
- Keep uncertainty visible. Never turn a plausible guess into a verified fact.
- Associate each phone/DOB with a person only when physical row evidence supports the link.
- Keep database changes transactional and organization-scoped. A scan must never silently create attendance or participation.
- Keep the frontend/review workflow as-is unless a separately proven UX defect requires a change. Accuracy work belongs in the backend pipeline.

**Meaning of “bulletproof”:** predictable failure handling, no silent data loss, no speculative corrections, no false automatic saves, and measured transcription accuracy on labeled registers. No model can guarantee perfect reading of illegible handwriting.

## 2. Current source-of-truth implementation

| Concern | Source |
|---|---|
| Provider request, strict schema, local response parser, provider retries, telemetry | `lib/hybridScanProvider.js` |
| Image normalization and crop views | `lib/scanImageViews.js` |
| Pipeline version and bounded visual QA instructions | `lib/scanReasoning.js` |
| Overlap alignment and row reconstruction | `lib/scanRegionMerge.js` |
| Phone/name/DOB validation, continuation contract, Review reasons | `lib/scanValidation.js` |
| Nigerian phone normalization/validation | `lib/phoneUtils.js` |
| Privacy-safe human-reviewed character cues | `lib/scanLearningHints.js` |
| Region blank/failure completeness states | `lib/scanCompleteness.js` |
| Identity matching, Review creation, transactional writes | `lib/identityResolver.js`, `lib/scanReviewStore.js`, `lib/visionProcessor.js` |
| Provider error categories and input-budget fallback | `lib/scanRequestBudget.js`, `lib/scanRateLimit.js` |
| Regression contract | `scripts/scan-regression.js` |
| Production job outcomes | `scan_jobs`; safe provider attempt metadata in `ai_usage_events`; restricted image evidence in `scan_evidence` |

Pinned vision provider/model: Groq `qwen/qwen3.8-27b` only. Do not add Gemini, Qwen 3.6, OCR.space, a second vision provider, or a schema migration without a separate measured proposal. Prompt cues are attention guidance only; they never rewrite the current image.

## 3. Request pipeline

1. **Admission and durable job:** the existing scan-start flow assigns an organization-scoped, idempotent job. Recent rate limiting is checked before starting work.
2. **Image preparation:** Sharp rotates using image metadata, limits width to 2,600 px without enlargement, normalizes, sharpens lightly, and encodes JPEG at quality 92. Do not add aggressive denoising/enlargement without paired-image evidence; transforms can erase or invent strokes.
3. **Budget-aware views:** for a prepared image shorter than 900 px, send one full-page view. For taller pages, send upper/lower full-width crops of about 62% page height each, overlapping by about 24%. Both carry original-page vertical bounds; the un-cropped page remains available for the explicit input-token-budget fallback. The default is **one provider request with two image views**, not two parallel provider calls.
4. **Vision extraction:** use temperature 0, `reasoning_effort: low`, `reasoning_format: hidden`, strict JSON Schema, and the model's configured 16,384-token completion ceiling. A maximum is not a target; actual usage is recorded. Hidden reasoning must not appear in output.
5. **Local response contract:** reject invalid JSON, unexpected field types/flags, invalid coordinates, more than 50 records, or an incomplete response. Ignore only physically blank entries with no name, phone, or DOB. Do not let formatting prose or partial/truncated JSON reach persistence.
6. **Recovery by failure class:** a known input-token-budget 413 gets one smaller full-page request; a short 429 may get at most two bounded same-model retries; invalid/unsupported structured JSON gets one constrained JSON-object recovery. Retries must change the failure condition or be bounded; never replay a known oversized request unchanged.
7. **Completeness and row reconstruction:** a blank output is not assumed to mean a blank register. The current blank confirmation contract remains. Preserve partial observations and avoid overlap duplication.
8. **Deterministic field validation:** normalize phone *format* and parse only complete, valid DOBs. Never edit a digit/name to make it pass validation. Record raw text and review reasons.
9. **Identity and persistence:** compare against organization-scoped records. Only confidently resolved, field-safe observations may flow to ordinary People creation/update. Partial, conflicting, malformed, or uncertain rows go to Review. Writes remain transactional; failures roll back.
10. **Honest result:** record row count, name/phone/DOB coverage, partial/uncertain-row counts, pipeline/model, finish reason, usage, latency, and failure class without logging raw names, phone numbers, image bytes, or the full extracted payload into provider telemetry.

## 4. Extraction schema

Every response is a strict object containing `people`. Each physical row object contains:

| Field | Contract |
|---|---|
| `r` | Required 1-based record ordinal assigned by a full-page top-to-bottom first pass. Sequential for person-bearing records only, with no gaps or duplicates. It is the authoritative review-order key; it is not an original printed number. |
| `y` | Integer from 0–1000: approximate vertical centre relative to the original full page, including when the text is read from a crop. |
| `n` | Raw full name transcription. May be empty only when another field on that physical record is visible. Never shorten, translate, infer, or spell-correct the raw transcription. `display_name` is normalized separately for consistent casing; `raw_name` preserves source text. |
| `p` | Array of zero to two literal phone strings actually visible and assigned to that row. Preserve visible prefix/digits and punctuation; downstream code removes formatting for validation. |
| `d` | Raw DOB text exactly as seen, or empty string when no DOB is written. Never infer a missing part or reuse a registration date. |
| `c` | Boolean. True only for a clearly proven blank-name continuation belonging to the immediately preceding person. Otherwise false. |
| `f` | Zero or more allowed flags: `digit_uncertain`, `continuation_uncertain`, `row_ownership_uncertain`, `name_uncertain`, `dob_uncertain`. |

The `y` coordinate is approximate and must not override a validated `r` order.

Emit a row if **any** of `n`, `p`, or `d` contains evidence. Do not emit an all-empty row. An empty name is a valid partial observation, not an invalid response. `c=true` is not permission to merge when uncertainty flags exist or the physical conditions fail.

## 5. Prompt rules and local conventions

The provider prompt explicitly calls this transcription rather than summarization or spell-checking and instructs Qwen to:
- Expect **Nigerian names, English names, Nigerian-English phrasing, mixed/compound names, and names from any Nigerian language**. Unfamiliar is not incorrect. Repeated titles on the same page are comparison cues, not authorization to rewrite the ink.
- Retain the complete written name: all titles/honorifics, initials, name parts, punctuation, and capitalization. Never remove an honorific or replace a rarer name with a more familiar spelling.
- Read each field independently so names-only, phone-only, and DOB-only observations survive.
- Treat Nigerian formats such as local numbers beginning with 0 and international `+234` / `234` as validation clues, **not digit-correction rules**. Never swap 1/7, O/0, or any other characters to make a number look valid.
- Read DOB only when physically written for that person and preserve its original form.
- Reconstruct physical rows across overlapping crops; do not duplicate a row appearing in both views.
- Do two passes: enumerate every person-bearing record from top to bottom, then transcribe and verify all fields in that fixed sequence. Recheck first, middle and final rows; output explicit sequential `r` ordinals and return records in `r` order. Use `y` as layout evidence, not as the final sort key when `r` exists.
- Standardize the display form of recognized honorifics and names (for example, `pastor Emma` → `Pastor Emma`). Keep the exact OCR reading in `raw_name` for auditability. A first-token `SB` in an honorific position is displayed as `Sis` as a narrowly scoped known-confusion repair, remains flagged for verification, and does not overwrite raw evidence.
- Include the current human-reviewed ARIA character-level scan hints in the prompt as attention cues only. Never auto-substitute arbitrary name or phone characters from learning; the current image remains authoritative.
- Mark unclear evidence and let Review resolve it.

The model's repeated visual pass is bounded and hidden. The current image remains more authoritative than any learned cue. The system must not pass whole historical member names or phone samples as prompt examples. Only repeated, human-reviewed, character-only cues may be used, and those cues must say “look again”, never “substitute automatically”.

## v78 display-name casing and deterministic top-to-bottom ordering

The v77 production scan was operationally successful, but inspection of its Review rows showed repeated leading `SB` readings where the register's honorific is expected to be `Sis`, lowercased titles such as `pastor Emma`, and a lack of a trustworthy source-order ordinal in the persisted review evidence. This is an extraction/readability issue, not a frontend styling issue.

v78 retains the existing provider and review contracts but adds:
1. **Two-pass order contract.** Qwen first enumerates person-bearing records from top to bottom and assigns required integer `r=1..N`; its second pass transcribes and checks fields against that sequence. The local parser rejects duplicate, missing, non-contiguous or out-of-range ordinals and sorts the response by `r` before region merging. The merger preserves that source order even if approximate `y` values contradict it. The scan validator then assigns Review's `row_number` in that stable sequence. `r` counts person-bearing records, not blank lines, headings or preprinted page numbers.
2. **Display-name normalization with provenance.** `normalizeDisplayName` formats recognized name tokens and honorifics consistently, so `pastor Emma` displays as `Pastor Emma` and `Bro onjekachi` as `Bro Onjekachi`. The original model text stays in `raw_name`; display normalization must never overwrite that audit evidence.
3. **Narrow SIS/SB repair.** When `SB` is the leading token immediately before a name, display uses `Sis` because this is an already-documented repeated honorific confusion in NYEOCARE's scan history. The raw transcription remains `SB ...` and `suspected_honorific_confusion` remains a Review reason. This is not a global character-substitution rule and does not authorize changing `SB` inside a name.
4. **Use ARIA learning correctly.** Existing repeated human-reviewed character-only scan cues continue to be supplied by `formatScanLearningHints`. They tell Qwen what to inspect, not what to replace. Do not feed member names/phone samples into the prompt and do not auto-correct other characters from learned statistics.

Release gates for v78: full scan regression, critical UI regression, application build/CI, deployed SHA check, and one fresh controlled register scan. Compare rows top-to-bottom against the original image; verify title casing and inspect `raw_name` alongside display form to confirm traceability. A passing build does not prove a transcription-accuracy percentage.

## 6. Validation and safe correction

### Phone numbers
Extraction preserves the image evidence. Normalization may remove spaces, brackets, hyphens, or a formatting-only plus sign as appropriate, and the Nigerian phone utility checks number shape. A common local Nigerian mobile format is 11 digits beginning with 0; an international form may start with `+234`. Landlines, foreign numbers, short/incomplete numbers, and unusual prefixes may exist.

**Do not automatically change a questionable digit to satisfy a regex.** Length/prefix checks can identify suspect data but cannot distinguish a handwritten 1 from 7. Keep the raw string, flag invalid/ambiguous values, and require human comparison with the pixels.

### Dates of birth
Keep `date_of_birth_raw` exactly as evidence. The validator accepts only supported complete and calendar-valid forms for normalized birthday storage. Partial, impossible, or ambiguous dates remain raw and go to Review; a missing DOB stays missing. Never infer a century or fill in a missing year.

### Names and identity
Keep the complete literal display/raw name. Parsing first/last-name columns for storage is a downstream representation, not a rewrite of the observed name. Honorific confusion (such as visually ambiguous SIS/SB) is flagged without silently changing the source. A name match is not proof that an uncertain phone belongs to that person. Identical names can belong to different people.

### Continuation ownership
A blank-name row is not a continuation merely because it is nearby. Attach it only when `c=true` (or an explicitly shared legacy row identifier establishes continuation), the row is in a plausible vertical position, neither continuation/ownership uncertainty flag exists, and the second phone/DOB does not conflict with the target record or exceed the two-phone limit. If any check fails, keep the partial row separate and flag it for Review. Never discard a third phone or merge two incompatible DOBs to make a row fit.

## 7. Review and persistence rules

Review is an expected safety mechanism, not an extraction failure:
- **Name only:** retain name; missing phone is a Review reason.
- **Phone only:** retain raw number; missing/uncertain name routes it to Review.
- **DOB only:** retain raw DOB; missing name and phone route it to Review.
- **Ambiguous title/name/digits/DOB:** retain best literal evidence with the applicable reason; do not auto-correct.
- **Possible shared phone, duplicate row, split row, or uncertain identity:** keep it unresolved; do not merge records solely on similarity.
- **Missing/partial/invalid model output:** do not persist guessed records; use the existing bounded recovery/failure/blank-confirmation flow.
- **Database failure:** the existing transaction should roll back. Do not turn a failed save into a success toast or report uncommitted counts as persisted records.

A scan is not attendance. No record from scan itself may mark a person present or absent or create participation.

## 8. Failure catalogue and fast remedies

| Symptom | Likely class | Fastest safe response |
|---|---|---|
| HTTP 413 says ITPM / input tokens per minute | Request exceeded provider input-token budget; waiting and replaying the same payload cannot fix it | Confirm the request used the budget fallback. If the fallback also fails, reduce image-view count or crop/token overhead; keep full-page coverage; add a regression test for the exact response. |
| HTTP 429 / OTPM | Shared provider output-token quota/capacity | Respect provider delay and the bounded retry/cooldown. Do not switch models or loop indefinitely. Check actual output/reasoning usage and whether quota settings changed. |
| Invalid JSON / strict schema rejected | Provider/schema compatibility or malformed completion | Permit the single same-model JSON-object recovery, then validate locally. Never split prose lines into people or accept partial/truncated JSON. |
| Correct JSON but wrong/missing name parts | Visual reading, prompt compression, resolution/layout, or quality problem—not a JSON-format problem | Compare row by row to the image; add a de-identified, human-verified regression case; improve literal-row instructions or selective image detail based on evidence. Never spell-correct automatically. |
| Phone appears under adjacent person | Row/continuation linkage | Inspect `c`, coordinates, flags, crop overlap and validator association. Keep ownership-uncertain rows separate. Never “fix” by the closest name or a guessed digit. |
| DOB absent or distorted | DOB column not physically readable, model ignored a field, or DOB not on that row | Confirm prompt/schema supports `d`, check DOB coverage telemetry, and test with a row where DOB is truly visible. Preserve partial raw text for Review; never invent missing parts. |
| Scan reports zero rows on a non-empty page | Empty/invalid extraction | Existing flow retries a constrained read and then asks for blank confirmation or fails safely. Compare source image size/rotation and provider attempt telemetry. Do not complete as successful empty extraction without explicit confirmation. |
| Duplicate people around crop overlap | Model row count/layout or overlap alignment problem | Compare rows and y values on the same image. Keep overlap, improve matching only from labeled evidence, and test both distinct close rows and duplicated overlap rows. |
| More Review rows than expected | Conservative field/identity safety, not necessarily an OCR regression | Read the concrete review reasons. Do not lower thresholds just to improve the headline count; only change a gate with benchmark evidence. |
| A failed provider request says nothing changed | Provider failed before the protected write transaction | Trust the terminal job state; inspect failure class and request ID. Correct the cause, then run a fresh retry through the existing idempotent job path. |

### Minimal diagnostic sequence (minutes, not hours)
1. Read the latest `scan_jobs` row: state, pipeline version, stage, elapsed time, extracted/review counts, error class and image hash.
2. Read matching `ai_usage_events` by job ID: model/version, HTTP status, finish reason, input/output/reasoning usage, latency and retry reason. These telemetry fields must not contain raw extracted personal data.
3. If complete, compare each returned row with the preserved restricted `scan_evidence` image. Check full name/honorific, every phone digit, DOB raw text, y position and ownership before claiming accuracy.
4. Re-run `npm run test:scan` for parser, validation, crop, retry and continuation changes; run `npm run test:critical-ui` to ensure the unchanged review/progress surface still matches the backend contract.
5. Verify CI/build, merge only when checks pass, then verify the Vercel production commit/state and complete a real controlled scan. Never claim “production-ready” from a green build alone.

## 9. Accuracy benchmark and release gates

Valid JSON, low latency, or successful database writes are not proof of accurate transcription. The current same-image trials recorded in `NYEO_SCAN_REASONING_BUDGET_TRIAL_2026-10-21.md` had 17–18 extracted rows, but a full row-by-row gold transcript was not verified. Therefore they are operational observations, not a verified accuracy score.

For a benchmark, keep the exact same image for baseline and candidate runs; manually verify ground truth privately. Report independently:
- physical row-count accuracy and final-row integrity;
- strict full-name accuracy including honorifics and every name part;
- phone digit accuracy after formatting-only normalization;
- phone-to-person ownership accuracy;
- DOB transcription/normalization accuracy;
- count of visible fields silently omitted;
- duplicate/split-row rate;
- review rate and false automatic-save rate;
- latency and input/output/reasoning token use.

Release safety gates: **zero silently dropped visible fields on the labeled test; zero false automatic saves in the benchmark; zero wrong phone-to-person links; all partial or uncertain records in Review; no incomplete/truncated response accepted.** Track exact transcription accuracy separately and set a numeric target before evaluating the next benchmark. Keep real register images, real people/phone/DOB values, and ground truth out of public commits, issues, screenshots, and CI artifacts.

## 10. Regression checklist

Before changing scan code, verify:
- [ ] Nigerian/English/compound names and full honorifics remain literal.
- [ ] A name-only row survives and is Reviewable.
- [ ] A phone-only row survives; it is not attached to a nearby person without explicit ownership.
- [ ] A DOB-only row survives region merging and is Reviewable.
- [ ] An entirely blank row is ignored; an entirely blank page follows the confirmation contract.
- [ ] A clear explicit continuation links correctly; an uncertain continuation remains separate.
- [ ] Invalid phone digits are flagged, not guessed or silently rewritten.
- [ ] Full and partial DOBs preserve raw text; only complete safe dates normalize.
- [ ] Output `r` values are sequential and review rows remain top-to-bottom even if `y` estimates are wrong.\n- [ ] `SB` honorific repair affects display only; raw text remains traceable and the ambiguity is flagged.\n- [ ] Titles and names use stable display casing without destroying initials or raw evidence.\n- [ ] Overlap duplicates are merged only with physical evidence; different nearby rows are preserved.
- [ ] Strict JSON, truncation rejection, 413 recovery, bounded 429 behavior, and organization scoping remain intact.
- [ ] Scan never writes attendance/participation, and ambiguous fields use Review.
- [ ] `npm run test:scan`, `npm run test:critical-ui`, build/CI, deployed SHA, and an actual controlled scan all pass before declaring completion.

## 11. Rollback

Rollback only to a known code commit and keep its pipeline version visible in job metadata. If low-effort reasoning materially worsens extraction, `SCAN_REASONING_EFFORT=none` is the existing emergency control; default remains `low`. If v78 top-to-bottom/casing or v77 partial-field/continuation handling regresses, revert the code changes as a set rather than reverting only the prompt and leaving the schema/parser/validator out of sync. Do not roll back by enabling another vision provider or an unvalidated OCR fallback.

**Non-negotiable:** improve accuracy with visual evidence and labeled tests; improve safety with deterministic validation and Review. Do not confuse automatic correction with accurate transcription.
