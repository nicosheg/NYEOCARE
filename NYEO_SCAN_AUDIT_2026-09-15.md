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

## 4. Supabase monitor result

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

## 5. Database integrity after successful scan

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

## 6. Supplied image comparison — visible portion

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

### Critical exception: Evelyn's phone
The first visible phone is physically written across two lines as approximately:
`07089946` followed by `4711`.

The literal visual sequence therefore appears to contain 12 digits if concatenated, while the successful model stored:
`07089946471`.

This must **not** be called a confirmed correct phone number. The model appears to have resolved an ambiguous/extra-digit visual situation into an 11-digit Nigerian number. That is exactly the kind of silent repair NYEOCARE's scan contract must prevent.

The correct product behavior for this case is:
- preserve the literal visible reading/evidence;
- mark the phone as uncertain when the physical ink cannot establish the exact intended number;
- do not silently delete, insert, transpose or repair a digit merely to make a number fit Nigerian normalization;
- send the row to Review Center for human confirmation.

Rows 12–14 cannot be visually verified from the supplied photograph because they are below the visible crop. Their database values are recorded, but this audit does not claim image-level correctness for those rows.

---

## 7. Important architectural discovery

The current scan is safe against **database corruption**, but it is not yet a mathematically guaranteed OCR truth engine.

The strongest part is now:

`vision → deterministic validation → transaction`

The remaining extraction-quality risk is:

`model visually misreads an ambiguous digit → produces a syntactically valid 11-digit phone → normalizer accepts it`

The normalizer correctly rejects malformed local Nigerian numbers, but it cannot know that the model silently dropped a visible digit. Therefore **format validity is not visual truth**.

This distinction is now part of the NYEOCARE scan contract.

---

## 8. Permanent scan rules

1. **Never equate HTTP success with extraction correctness.** Inspect provider telemetry and extracted evidence.
2. **Never equate phone-format validity with visual correctness.** An 11-digit Nigerian number can still be the wrong reading.
3. **Never silently repair phone digits.** If the physical ink is ambiguous, preserve uncertainty and require review.
4. **Never attach a nearby phone because it makes a row valid.** Physical row ownership is primary.
5. **Continuation lines require physical evidence.** A number below a name belongs to that person only when the layout supports that relationship.
6. **A malformed-looking phone is evidence, not a prompt to normalize it into a plausible number.**
7. **Review status is allowed to be conservative.** Uncertain rows must remain reviewable rather than being upgraded to verified truth.
8. **Successful scan ≠ verified identity.** A successful scan means the extraction transaction completed safely.
9. **Scan ≠ attendance.** A register scan never creates attendance or participation.
10. **No People writes before extraction validation.**
11. **Model registry and provider request ceilings must agree.**
12. **Provider/model failures must be classified explicitly.** 404 → `AI_MODEL_UNAVAILABLE`; 429 → rate limit; 200 + `length` → truncation; abort → timeout.
13. **Monitor every production scan.** Inspect `scan_jobs` and `ai_usage_events`, not just the UI.
14. **Record pipeline version, model, request ID, HTTP status, token usage, finish reason and latency.**
15. **A repeat scan of the same image is a valid regression test.** It must use current identity state and must not return stale completed-image results.
16. **When a scan fails before commit, existing People remain untouched.**
17. **When a scan succeeds with review-sensitive rows, the Review Center is the authority for human confirmation.**

---

## 9. Regression test matrix

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
| Same-register rescan | current extraction + identity state; no stale cache |
| Successful scan | job complete + telemetry + durable People + review state |

---

## 10. Current conclusion

The major infrastructure failures exposed on 15 September 2026 are now understood and the production scan path has successfully completed a real register scan.

The system is no longer at the stage of guessing why scans fail.

The next quality benchmark is **not another provider swap**. It is measured extraction accuracy: exact name spelling, exact phone digits, and correct physical row ownership against known register images.

For future scan incidents, the first response must be:

`AUDIT JOB → AUDIT AI TELEMETRY → AUDIT REPOSITORY VERSION → COMPARE ORIGINAL IMAGE → CHECK DATABASE MUTATION → THEN CHANGE CODE`

Do not skip directly to changing the model, prompt, timeout or database.
