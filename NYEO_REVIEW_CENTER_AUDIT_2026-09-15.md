# NYEOCARE — Review Center Hardening Record
**Date:** 15 September 2026
**Status:** Implemented against the live repository and live Supabase database

## Finding
The first successful 14-person scan was being presented as 14 Review Center decisions even though the scan had completed successfully. This was a review-policy bug, not proof that all 14 identities were wrong.

## Root cause
The vision compactor converted omitted `nc`, `pc`, and `rc` evidence scores into numeric zeroes. The validator then interpreted those synthetic zeroes as weak evidence and created `low_name_evidence` / `low_phone_evidence` review flags. It also treated an absent model row number as `row_evidence_needs_verification`.

For the successful production scan, the model did not provide a row number for these people. The validator therefore over-flagged the entire result set.

## Permanent review contract
`needs_review` must be evidence-targeted.

A missing optional model evidence field is **not** the same as low evidence.

A missing optional model row number is **not** automatically a row conflict. When the model returns records in extraction order, that order remains the deterministic row sequence; a supplied duplicate/invalid row number is the actual row conflict condition.

Review should be created for concrete uncertainty or conflict such as:
- malformed/unreadable phone;
- missing phone where one is expected;
- shared or duplicate phone identity;
- corrupted/unreadable name;
- explicitly weak model name/phone/pair evidence when the model actually supplied a score;
- duplicate model row numbers;
- explicit identity conflict/candidate ambiguity.

A clean extraction with omitted optional confidence fields can pass without entering Review Center.

## Action reliability
Review actions were also hardened:
- Review API calls retry once after a 401 using Supabase session refresh.
- Successful actions clear the active review state directly instead of attempting to close while `busy=true`.
- `Edit before remembering` sends the edited name and phone values through the existing transactional resolver.
- Database duplicate actions now execute immediately with the intended action instead of setting React state and then calling a function that could read stale state.
- Duplicate merge/keep-separate remains protected by server-side evidence validation and database transactions.

## Name intelligence
The scan prompt now explicitly recognizes Nigerian, African and English naming patterns and tells the model to use cultural familiarity only as a reading aid, never as proof. Uncommon names must be preserved. High-confidence spelling suggestions can be surfaced in Review Center, but a suggestion is not ground truth.

## Live database cleanup
The 14 people created by successful job `97986786-5821-4785-8be4-bdc1f1ec510a` were previously marked `needs_decision` solely by the legacy blanket review policy. They were migrated to `living_truth.status='alive'` with `metadata.needs_review=false` and a migration marker `legacy_overflagged_2026_09_15`. Their identity verification status remains separate from this change; this does not manufacture human verification.

Live database check after migration:
- active People: 36
- current Review Center queue under the new policy: 0
- rows from the successful scan now in normal alive state: 14

The remaining review system is therefore available for actual future uncertainties rather than replaying the old blanket flags.

## Implementation files
- `lib/scanValidation.js` — evidence-targeted review generation; absent confidence is not treated as zero.
- `lib/aiProviderCore.js` — preserve omitted confidence fields and harden name-reading instructions; pipeline `v45-qwen38-single-pass-review-v2`.
- `lib/scanExtractionProcessor.js` — persist actual review evidence fields for future Review Center decisions.
- `lib/nameIntelligence.js` — broader Nigerian/African/English familiar-name suggestions.
- `pages/api/review/index.js` — only explicit review-required scan records or conflicts are returned.
- `components/ReviewCenterTab.js` — reliable save/refresh behavior, spelling suggestions and working duplicate actions.

## Regression rule
Before any future review change, test at minimum:
1. clean extraction with no confidence fields → **not automatically review**;
2. supplied low confidence → **review**;
3. missing/invalid phone → **review**;
4. duplicate/shared phone → **review**;
5. corrupted name → **review**;
6. duplicate model row → **review**;
7. 401 during review action → refresh and retry;
8. edited record → transaction commits, queue item disappears;
9. duplicate merge / keep separate → intended action is actually sent;
10. human confirmation remains distinct from extraction success.
