# NYEOCARE — Scan Reasoning and Token Budget Trial
**Trial date:** 21 October 2026  
**Scope:** controlled scan-quality investigation; no schema changes and no automatic People writes beyond the existing validated production pipeline.

## Decision
Keep Groq `qwen/qwen3.8-27b` as the only vision model. Trial `reasoning_effort: "low"` with `reasoning_format: "hidden"`, a bounded visual-verification instruction and the existing compact strict JSON schema. Do not ask for visible prose before JSON: previous runs showed the strict provider format can be rejected, and the production consumer expects JSON. A single bounded verification pass should help the model re-check row counts and ambiguous character shapes without generating a free-form reasoning transcript.

The request completion ceiling remains `Math.min(900, model.max_completion_tokens)` to reduce exposure to the 1,000-token-per-minute output limit observed on the previous provider tier. This can still truncate an exceptionally dense page; a `finish_reason: "length"` must stay a hard failure and must never be parsed as complete. Roll back to `SCAN_REASONING_EFFORT=none` only if the low-effort canary shows loops, truncation or worse extraction.

## Same-image production comparison
The three jobs below have the exact same SHA-256 image hash:
`bcebc8d35e7e6effd1120f5fa9a38dcefa8e5743a6a19bdaa3b5e4b9a082ba13`.
That makes the scan-view/token comparison more meaningful than comparing unrelated photos. These results do **not** constitute a ground-truth accuracy benchmark because the handwritten transcript is not yet fully verified.

| Pipeline | Image views in one request | Rows sent to review | Input tokens | Output tokens | Scan-job duration | Estimated API cost |
|---|---|---:|---:|---:|---:|---:|
| v72 `single-full-page-otpm-safe` | Full page | 17 | 2,210 | 482 | 7.274 s | $0.003696 / about ₦4.93 |
| v73 `single-call-multiview-ocr` | Full + upper + lower detail | 18 | 4,975 | 512 | 11.760 s | $0.006028 / about ₦8.03 |
| v74 `scan-learning-and-row-qa` | Full + upper + lower detail, with learning cues | 17 | 5,116 | 601 | 11.951 s | $0.0064968 / about ₦8.66 |

**Cost formula used:** `input_tokens × $0.80 / 1,000,000 + output_tokens × $4.00 / 1,000,000`, matching the published Groq Qwen 3.8 model page on the audit date. Naira conversion uses a 21 October 2026 reference rate of ₦1,332.68 per USD; card/bank conversion and final invoice rounding may differ.

Total across these three completed requests was 12,301 input tokens + 1,595 output tokens = 13,896 reported tokens, at approximately **$0.016221 (₦21.62)**. Failed HTTP 400/429 attempts in the separate failed job reported zero input/output tokens and are not included.

## What the same-image comparison says
- The full-page request was cheapest, but cost alone does not prove it was accurate.
- The first multi-view run returned 18 rows and split the final line into two entries at the same vertical coordinate (`y=920`). This is a concrete false-row risk.
- v74 returned 17 rows and added 10 suspected-honorific review flags for `SB` readings. This improves visibility of a known failure mode, but it does not prove the names themselves are correct. The uploaded page contains names only, so it cannot validate phone or DOB extraction.
- v74 cost about 76% more than v72; multi-view is retained for the first reasoning canary because it preserves both global layout and close handwriting detail. Do not invest in a new crop architecture before measuring accuracy.

## Canary protocol
1. Hold the model, input photo, three image views, JSON schema, learning cues and 900-token ceiling constant. Change only reasoning effort from `none` to `low`. This isolates the reasoning experiment.
2. Run the same names-only register through the current app once. Compare it with the saved v74 result: row count, each literal name, honorific, spelling, final-row integrity, review flags, token usage and end-to-end latency.
3. Do not call this a win if only the JSON parses. A human must verify each row against the image. Do not infer phones or dates that are not on this page.
4. If low reasoning is at least as accurate, does not truncate or loop, and remains within a reasonable token/latency increase, keep it. If not, set `SCAN_REASONING_EFFORT=none` and stop; do not swap models.
5. Only after this first canary, expand to a small set of real registers with manually verified transcripts. Keep real names, phone numbers, images and ground truth out of public source control and CI artifacts.

## Safety and scope
- No alternate vision provider/model.
- No OCR.space fallback.
- No schema migration.
- Existing region-completeness, validation, identity-resolution, review and transaction guards remain in place.
- The test is a prompt/effort experiment, not permission to auto-correct extracted names or merge people.
- The separate durable checkpoint/retry phases remain separate work; this trial does not claim to solve long rate-limit waits or job resumption.

## References
- Groq Qwen 3.8 model page and published prices: https://console.groq.com/docs/model/qwen/qwen3.8-27b
- Groq reasoning effort options: https://console.groq.com/docs/reasoning
- Historical production code and data are recorded in repository scan audit/spec files; verify the current database and code before making any later accuracy claim.
