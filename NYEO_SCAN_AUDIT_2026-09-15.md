# NYEOCARE — Scan Audit & Recovery Record
**Audit date:** 15 September 2026
**Status:** Verified against live repository + live NYEOCARE Supabase + supplied register image

This document is part of the NYEOCARE engineering specification set. It records the real scan failures that occurred on 15 September 2026, the root causes, the recovery, the successful verification scan, and the permanent rules that must govern future scan changes.

---

## 1. Executive finding

The scan was successfully restored by moving production extraction from the failing `qwen/qwen3.6-27b` request path to the previously proven `qwen/qwen3.8-27b` path.

The successful production scan:
- job: `97986786-5821-4785-8be4-bdc1f1ec510a`
- pipeline: `v44-qwen38-single-pass-observable`
- provider: Groq
- model: `qwen/qwen3.8-27b`
- HTTP: 200
- finish reason: `stop`
- latency: 4.084s provider telemetry / 9.138s complete scan job
- input tokens: 2,128
- output tokens: 561
- total tokens: 2,689
- extracted: 14
- valid: 14
- new members: 14
- rejected: 0
- duplicates: 0
- People written: 14
- scan status: `complete`

The database result explicitly records `single_pass_internal_reasoning_local_regulator`, one pass, reviewed=true and agreement=true. This is the current production scan contract.

**Correction to the earlier visual audit:** the user's confirmation is authoritative for the supplied register: Evelyn's phone extraction was correct. The apparent mismatch came from the audit viewer failing to resolve the handwritten two-line phone correctly, not from ARIA's extraction. The audit must therefore distinguish a model extraction error from an auditor/viewer transcription error.

---

## 2. Failure chronology and root causes

### A. `42P02` transaction-lock failure
Job: `f2891af7-7a08-4a9a-925d-12785e9ede0e`

The scan reached the database transaction stage and PostgreSQL returned `42P02`. Root cause was a server-side SQL call that used `$1` without passing the job ID parameter to `client.query` in the `active(client,id)` lock check.

**Impact:** no unsafe People mutation occurred.

**Permanent rule:** every SQL placeholder must have an explicit matching parameter array, and transaction/lock queries must be tested against the real PostgreSQL schema before being considered complete.

---

### B. `AI_OUTPUT_TRUNCATED`
Job: `46cb38b7-a596-47ef-a4ff-23e8b630a7ba`

Groq returned HTTP 200, but the vision response ended with `finish_reason=length`.

Telemetry:
- input: 2,420
- output: 4,800
- reasoning: 4,606
- total: 7,220

The immediate configuration mismatch was that the scan code requested up to 5,200 tokens but the model registry still capped Qwen 3.6 at 4,800. The model therefore exhausted the effective completion ceiling.

**Impact:** extraction was aborted before database writes. Nothing was changed.

**Permanent rule:** model-registry limits and provider request limits must never disagree. Effective scan ceilings must be derived from one authoritative model registry entry.

---

### C. `AI_TIMEOUT`
Job: `56c65879-aa78-42f0-b8ab-e4721238fecc`

The vision request exceeded the then-active request timeout and stopped after about 31.5 seconds.

**Impact:** no People mutation.

**Fix:** vision timeout was increased to 60 seconds with a 70-second pipeline deadline, and the scan stall detector was extended to 120 seconds so it does not classify a healthy long-running vision request as stalled.

**Permanent rule:** provider timeout, overall scan deadline, and stall-reconciliation timeout must be designed together. Never increase only one of them.

---

### D. `AI_PROVIDER_ERROR` / HTTP 404
Job: `b4671f8f-00d6-45cb-9027-720b4d106ac1`

Groq returned HTTP 404 for `qwen/qwen3.6-27b` with zero tokens consumed.

Telemetry:
- HTTP: 404
- input/output/reasoning/total: 0
- latency: 2.114s provider telemetry
- request ID: `0e955f92-f763-4b2c-8ca3-57ac66174ac1`

This was not an image problem, token truncation, timeout, database failure, or extraction-quality failure. The provider rejected the model request before processing the image.

The status endpoint was also hardened so a future 404 is classified as `AI_MODEL_UNAVAILABLE` rather than the misleading generic `AI_PROVIDER_ERROR`.

**Important current-provider fact:** Groq's current documentation lists both `qwen/qwen3.6-27b` and `qwen/qwen3.8-27b` as active vision models. Therefore the historical 404 must not be described as proof that Qwen 3.6 is universally deprecated. It was a real request-level model availability/configuration failure in this production attempt. NYEOCARE's safe response is to use the verified production model and classify future 404s explicitly.

---

## 3. Successful recovery scan

Production was switched back to the proven Qwen 3.8 27B single-pass pipeline.

Current repository contract:
- `SCAN_MODEL_KEY='groq-qwen3.8-27b'`
- model: `qwen/qwen3.8-27b`
- max completion budget in registry: 5,200
- request ceiling: `Math.min(5200, MODEL.max_completion_tokens)`
- primary timeout: 60,000ms
- overall deadline: 70,000ms
- maximum extracted people: 50
- one vision request
- JSON object mode
- reasoning effort: `default`
- reasoning output: hidden
- deterministic local regulator after the model response
- validation before the People transaction

Groq's current documentation confirms Qwen 3.8 27B supports vision, OCR, JSON Object Mode, Structured Outputs, and reasoning, with a 16,384-token maximum output ceiling. Groq's published rate-limit table currently lists 8K TPM for Qwen 3.8, so NYEOCARE's observed 2,689-token successful scan is comfortably below that ceiling.

---

## 4. Vision reasoning is a first-class scan requirement

This is a critical architectural rule and must not be lost during future optimization.

A vision model performing register extraction is not equivalent to a traditional local OCR engine. The model must be allowed to **reason over the page structure and visual evidence**: reconstruct rows and columns, determine which digits belong to which person, inspect split/continuation lines, distinguish handwriting from ruling lines and shadows, preserve uncommon names, and reconsider ambiguous characters against the actual image.

Therefore:

- **Never disable model reasoning for production register vision merely to save latency or tokens.** Do not configure `reasoning_effort:'none'` for the scan path unless a controlled benchmark proves that it improves exact visual extraction without increasing pairing or digit errors.
- The scan prompt must continue to explicitly instruct the model to inspect the physical layout, test ambiguous readings against the ink, and re-check name/phone ownership.
- `reasoning_format:'hidden'` is acceptable: hidden reasoning means the internal reasoning is not exposed to the user; it does **not** mean reasoning is disabled.
- `reasoning_effort:'default'` is currently the production setting. The fact that the latest successful event recorded `reasoning: 0` does not prove reasoning was disabled; it means no separately metered reasoning tokens were recorded for that successful request.
- If a future optimization changes reasoning effort, compare exact visual accuracy against the current baseline first. Do not judge the change from latency or token cost alone.

**Core principle:** without adequate visual reasoning, register extraction can regress toward brittle OCR-like behavior: text may look plausible while row ownership, ambiguous digits, split phone numbers, and handwriting context are lost. NYEOCARE's benchmark is therefore not “did it return text?” but “did it reconstruct the visible register correctly?”

This rule is now part of the permanent scan contract.

---

## 5. Why the successful rows appeared in Review

The 14 extracted People being review-sensitive does **not** mean ARIA judged all 14 extractions to be wrong.

The current validator is deliberately conservative. In `lib/scanValidation.js`, a row is added to `needsReview` when any review reason is present, including:
- missing/invalid model row evidence;
- model row duplication;
- `row_confidence < 75` (`rc < 75`);
- weak name evidence;
- weak phone evidence;
- shared phone or other safety conditions.

The important distinction is:

`needs_review` = **human confirmation is appropriate**

not:

`needs_review` = **ARIA believes the extracted name/phone is wrong**.

For a clean row where name, phone and physical row ownership are strongly supported, the product should eventually be able to show a normal/high-confidence extraction without forcing the operator to review every row. Review should be targeted at actual uncertainty or conflict, not become a blanket post-scan ritual.

At the same time, NYEOCARE must not remove review merely because a row “looks plausible.” The correct future design is evidence-based review: use the model's visual evidence/confidence plus deterministic checks and physical-row consistency to decide which rows truly need human confirmation.

---

## 6. Supabase monitor result

The live `ai_usage_events` monitor confirms the recovery was real, not merely a UI success.

Latest successful event:
- model: `qwen/qwen3.8-27b`
- HTTP: 200
- success: true
- finish: `stop`
- input: 2,128
- output: 561
- reasoning: 0 recorded
- total: 2,689
- latency: 4,084ms
- job: `97986786-5821-4785-8be4-bdc1f1ec510a`

The previous events show the exact failure progression: Qwen 3.6 produced valid 200 responses before one truncation and then a 404; the Qwen 3.8 recovery produced a clean 200/stop response.

This establishes that the scan monitor must always be checked alongside the user-facing result. A green UI message alone is not sufficient evidence of provider success.

---

## 7. Database integrity after successful scan

The completed scan job reports:
- 14 extracted
- 14 valid
- 14 remembered
- 14 new members
- 0 rejected
- 0 duplicates

All 14 resulting People have `last_scan_job_id` equal to the successful job ID, confirming their origin in this scan.

They are stored with:
- source=`scan`
- identity verification=`unverified`
- no automatic identity verification source
- one normalized phone in the current records

This is correct for the current review-first identity model: successful extraction creates durable People, while uncertain identity evidence remains reviewable rather than being silently treated as verified truth.

---

## 8. Supplied image comparison — visible portion

The supplied register photograph visibly contains the first portion of the register. The successful extraction agrees strongly with the visible rows for:

1. Evelyn
2. Sis Ngozi
3. Sis Patience
4. Confidence
5. Mrs Amaka Azubuike
6. Happiness
7. Racheal
8. Ngozi
9. Sister Aunus
10. Sister Blessing
11. Mama Health

The visible phone readings for rows 2–11 are consistent with the stored extraction in the supplied image to the extent the photograph permits verification.

### Evelyn correction
Evelyn's phone was correctly extracted by ARIA. The apparent mismatch in the previous audit was an error in the audit-side visual reading of the two-line handwritten number. This is an important audit lesson: **the evaluator can be wrong even when the vision extraction is correct.** Future image comparisons must avoid promoting uncertain human visual transcription into a claimed model error.

Rows 12–14 cannot be visually verified from the supplied photograph because they are below the visible crop. Their database values are recorded, but this audit does not claim image-level correctness for those rows.

---

## 9. Important architectural discovery

The current scan is safe against **database corruption**, but it is not yet a mathematically guaranteed OCR truth engine.

The strongest part is now:

`vision + visual reasoning → deterministic validation → transaction`

The remaining extraction-quality frontier is measured visual accuracy:

`exact characters + exact phone digits + correct physical row ownership`

A syntactically valid phone is not automatically visually correct, and a successful HTTP response is not automatically an accurate extraction. Conversely, a conservative review flag is not automatically evidence that the extraction is wrong.

The evaluator itself must also remain fallible: when comparing a model result to an image, uncertain human visual readings must be labeled as uncertain rather than treated as ground truth.

---

## 10. Permanent scan rules

1. **Never equate HTTP success with extraction correctness.** Inspect provider telemetry and extracted evidence.
2. **Never equate phone-format validity with visual correctness.** An 11-digit Nigerian number can still be the wrong reading.
3. **Never silently repair phone digits.** If the physical ink is ambiguous, preserve uncertainty and require review.
4. **Never attach a nearby phone because it makes a row valid.** Physical row ownership is primary.
5. **Continuation lines require physical evidence.** A number below a name belongs to that person only when the layout supports that relationship.
6. **A malformed-looking phone is evidence, not a prompt to normalize it into a plausible number.**
7. **Do not disable vision reasoning in production without a benchmark.** `reasoning_format:'hidden'` is not reasoning-off; the scan must retain adequate model reasoning capacity for visual reconstruction.
8. **Review status is not an error verdict.** `needs_review` means human confirmation is appropriate, not that ARIA believes the row is wrong.
9. **Review should be evidence-targeted.** Do not force every clean extraction into Review Center merely because a conservative default or missing nonessential evidence field triggered a generic flag.
10. **Successful scan ≠ verified identity.** A successful scan means the extraction transaction completed safely.
11. **Scan ≠ attendance.** A register scan never creates attendance or participation.
12. **No People writes before extraction validation.**
13. **Model registry and provider request ceilings must agree.**
14. **Provider/model failures must be classified explicitly.** 404 → `AI_MODEL_UNAVAILABLE`; 429 → rate limit; 200 + `length` → truncation; abort → timeout.
15. **Monitor every production scan.** Inspect `scan_jobs` and `ai_usage_events`, not just the UI.
16. **Record pipeline version, model, request ID, HTTP status, token usage, finish reason and latency.**
17. **A repeat scan of the same image is a valid regression test.** It must use current identity state and must not return stale completed-image results.
18. **When a scan fails before commit, existing People remain untouched.**
19. **When a scan succeeds with review-sensitive rows, the Review Center is the authority for human confirmation.**
20. **When auditing an image, the auditor must label uncertain visual readings as uncertain.** Never turn an uncertain audit reading into a claimed extraction failure.

---

## 11. Regression test matrix

Every meaningful scan change should be checked against at least these cases:

| Case | Expected behavior |
|---|---|
| Clear 11-digit phone | Preserve exact digits and normalize only after extraction |
| Phone split over two physical lines | Join only when layout proves continuation |
| Extra/ambiguous digit | Preserve uncertainty; never silently repair |
| Blank continuation row | Review physical linkage before ownership |
| Shared phone | Review; never automatic merge |
| Duplicate name | Use phone/identity evidence; never name-only merge |
| Poor image | Fail safely or return review-sensitive extraction; never invent |
| Model 404 | `AI_MODEL_UNAVAILABLE`; no People writes |
| Model 429 | `AI_RATE_LIMIT`; no People writes |
| Provider timeout | `AI_TIMEOUT`; no People writes |
| Output truncation | `AI_OUTPUT_TRUNCATED`; no People writes |
| Database transaction failure | rollback/no partial People mutation |
| Reasoning disabled | **Do not accept as production scan configuration without a measured accuracy benchmark** |
| Reasoning enabled/default | Baseline configuration; compare exact visual extraction accuracy |
| Same-register rescan | current extraction + identity state; no stale cache |
| Successful scan | job complete + telemetry + durable People + targeted review state |

---

## 12. Current conclusion

The major infrastructure failures exposed on 15 September 2026 are now understood and the production scan path has successfully completed a real register scan.

The current verdict is **GREEN for infrastructure and safety; YELLOW for extraction-quality measurement; RED for any attempt to optimize by blindly removing visual reasoning.**

The successful 14-person scan is strong evidence that the Qwen 3.8 single-pass architecture is viable. The fact that the rows entered review does not mean the extraction was poor; the current validator is conservative and can over-flag when evidence/confidence fields are weak or absent. The next improvement should therefore be to measure and tune **targeted review**, not to assume the model failed.

The next quality benchmark is **not another provider swap**. It is measured extraction accuracy: exact name spelling, exact phone digits, and correct physical row ownership against known register images, with human audit errors treated separately from model errors.

For future scan incidents, the first response must be:

`AUDIT JOB → AUDIT AI TELEMETRY → AUDIT REPOSITORY VERSION → COMPARE ORIGINAL IMAGE → CHECK DATABASE MUTATION → THEN CHANGE CODE`

Do not skip directly to changing the model, prompt, timeout, reasoning setting or database.
