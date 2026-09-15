# NYEOCARE — Canonical Scan + Review Center Contract
**Date:** 15 September 2026
**Status:** Implemented against the live repository and live Supabase database

## Core decision
Groq vision confidence is accepted as a real evidence signal because the model sees the register image and its reasoning is explicitly instructed to inspect the visual evidence. It is **not** blindly accepted as truth: deterministic local validation remains the safety regulator for malformed data, duplicate phones, row conflicts and impossible states.

Therefore:
- **Model confidence = visual evidence.**
- **Local validation = safety boundary.**
- **Human review = final authority when visual evidence is genuinely uncertain.**
- Unfamiliar name != wrong name.
- Name suggestion != review by itself.
- Nigerian-number plausibility != proof of correct digits.
- Extraction success != human identity verification.

## Canonical flow
`REGISTER IMAGE → GROQ QWEN 3.8 VISION + REASONING → LOCAL EVIDENCE REGULATOR → ACCEPT or NEEDS_REVIEW → HUMAN DECISION → LIVING TRUTH`

## Groq visual contract
The production prompt requires ARIA/Groq to:
- reconstruct physical rows, columns and name/phone ownership;
- recognize Nigerian, African and English names broadly, including Igbo, Yoruba, Hausa, Edo, Efik, Ibibio, Urhobo, Itsekiri, Tiv, Ghanaian and other African naming patterns;
- preserve uncommon but visually supported names instead of replacing them with familiar names;
- use `ns`, `ps`, `rs` visual evidence states: `clear`, `ambiguous`, `unreadable`;
- provide `nc`, `pc`, `rc` confidence scores only when honestly supported;
- provide up to three visually supported name alternatives when useful;
- flag possible phone digit uncertainty, missing/extra digits, continuation uncertainty, row ownership uncertainty or visible number corruption;
- copy phone digits literally and never repair them merely to satisfy Nigerian number formatting.

The model may recognize a name it did not previously know. The system does not require a name to exist in a fixed dictionary before accepting it.

## Review thresholds
When Groq supplies visual confidence, the local regulator uses it as evidence:
- name confidence `< 80` → review;
- phone confidence `< 90` → review;
- name↔phone pairing confidence `< 85` → review.

The explicit visual states also matter:
- `name ambiguous/unreadable` → review;
- `phone ambiguous/unreadable` → review;
- `pair ambiguous/unreadable` → review;
- phone digit/continuation/number-corruption flags → review.

Missing optional confidence fields do **not** become zero and do **not** automatically create review decisions.

## Deterministic safety rules
Always review/reject as appropriate for:
- missing/unreadable phone;
- malformed phone;
- shared phone across rows;
- duplicate identity within a scan;
- corrupted name;
- duplicate model row number;
- explicit row ownership conflict.

The regulator never silently truncates, pads, transposes, repairs or borrows phone digits.

## People state
A genuinely uncertain extraction may be stored in People for durable memory, but its `living_truth.status` is `needs_decision` and its metadata records the exact evidence/reasons. Review Center is therefore not a separate temporary OCR database; it is the human decision layer over the stored extraction.

A clean extraction can be stored as `alive` without becoming `identity_verification_status='verified'`. Human verification remains a separate state.

Existing people detected during a new scan follow the same rule: a genuine new uncertainty moves the existing record to `needs_decision`; a clean observation does not.

## Live remediation on 15 September 2026
The earlier blanket-review migration was corrected rather than reused as truth. The successful 14-person scan was not re-flagged wholesale. Based on the existing visual audit, two of those legacy records were deliberately reopened for genuine visual uncertainty: one phone reading and one handwritten name. A separate pre-existing `needs_decision` record with a real phone-validation reason was also repaired so it is visible to Review Center.

Current live DB check after canonicalization:
- active People: 36
- genuine scan review queue: 3
- all active `needs_decision`: 3
- flagged review records: 3

## Implementation
- `lib/aiProviderCore.js` — Qwen 3.8 visual-reasoning prompt, visual evidence fields and confidence preservation; pipeline `v46-qwen38-visual-evidence-review-v3`.
- `lib/scanValidation.js` — accepts model visual confidence as evidence while applying deterministic safety rules and targeted thresholds.
- `lib/scanExtractionProcessor.js` — persists visual evidence and moves existing/new records into `needs_decision` when genuine uncertainty exists.
- `pages/api/review/index.js` — returns every active `needs_decision` record that actually contains review reasons, preventing orphaned review states.
- `components/ReviewCenterTab.js` — existing transactional review UI remains the human correction surface.

## Regression contract
1. Clear Nigerian/African/English name + high visual confidence → accept.
2. Unfamiliar but visually clear name → accept; never dictionary-reject it.
3. Name alternative without visual ambiguity → accept; suggestion alone is not review.
4. Ambiguous name / low name confidence → review.
5. Clear unusual phone → accept; unusual format alone is not review.
6. Ambiguous/missing/extra phone digit → review.
7. Wrong-row phone ownership → review.
8. Missing optional confidence → do not synthesize zero.
9. Existing person with genuine new uncertainty → move to `needs_decision`.
10. Human correction/approval → resolve transactionally and separately mark human verification.
11. Failed/unsafe scan → no partial People mutation.
12. Scan success never means attendance.
