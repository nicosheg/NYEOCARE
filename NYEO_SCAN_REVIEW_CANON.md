# NYEOCARE — Canonical Scan & Review Contract

## Core principle
Qwen is NYEOCARE's replaceable vision observer. It reads what is visibly present on the current register and returns structured observations with physical coordinates, row order, field evidence and uncertainty. ARIA/the NYEOCARE system owns reconstruction, validation, identity resolution, persistence, review, learning and truth decisions. A model can be replaced without changing that responsibility boundary.

## Whole-page observation
The default scan is **one carefully prepared full-page vision request**. Qwen must inspect the entire page from top to bottom before producing rows. The observer prompt explicitly asks it to map columns, indentation, vertical spacing, continuation lines and name-to-phone physical relationships rather than treating the page as a flat OCR stream.

This is intentionally different from the earlier multi-region approach. Splitting a page can destroy the very spatial context needed to decide whether a number belongs to the row above, the row below or a continuation line.

A single controlled retry is allowed only when the provider actually fails (for example a rate limit or temporary provider error). A fallback Qwen model may recover a failed request. No verifier model is part of the normal scan path.

## Physical row and geometry are authoritative evidence
The physical register is not a flat text stream. Preserve top-to-bottom row order, column alignment, indentation, vertical spacing, continuation lines and other visible connectors between names and phone numbers.

A phone on a blank continuation line belongs to the preceding person when the image provides clear physical evidence that it continues that person's phone field. Do not shift that number to the next named person merely because the next name is visually closer in OCR text order.

### Canonical Sandra benchmark
The Carrillion handwritten-register benchmark contains a critical continuation case:
- **Sis Sandra Isiche/Isichei** owns **two phone numbers**.
- The second number, `08183488629`, is written on the continuation line immediately beneath Sandra's row and remains aligned with Sandra's phone column.
- The next named person is **Sis Tonia Isichei**, whose phone is `08165264100`.
- Therefore `08183488629` must remain attached to Sandra and must never be shifted to Tonia.

This benchmark is a required regression case for future scan prompts, validators and OCR/HTR integrations.

## Qwen's responsibility
Qwen must:
1. observe the whole page;
2. return each visible logical row once;
3. preserve literal name and phone readings;
4. report physical coordinates and row relationships;
5. flag uncertainty rather than inventing a correction.

Qwen must **not** decide whether a person already exists, merge people, create database identities, or silently repair characters because a different value looks more plausible.

## System responsibility
After Qwen returns observations, NYEOCARE must:

`IMAGE → single full-page Qwen observation → physical row reconstruction → deterministic field validation → learning/prior lookup → identity resolution → safe persistence or Review Center`

The system distinguishes **identity certainty** from **field certainty**. A known person with a disputed phone digit is still that known person; the disputed field goes to Review Center. An uncertain identity is never written into `people` as a placeholder.

### Absolute persistence rule
**A scan may never create a new `people` record merely because identity resolution is uncertain.**

The only outcomes are:
- known existing person + clean fields → recognize existing;
- known existing person + field conflict → review the observation against that person, without creating another person;
- genuinely new person + sufficiently trustworthy extraction → create a new person;
- ambiguous/unreadable identity → Review Center only.

## Similarity and duplicate detection
Identity search must not depend on exact equality. NYEOCARE compares normalized names, token similarity, aliases, full phones, phone digit similarity and physical/scan evidence. Candidates at roughly **70% similarity or higher** are eligible for duplicate review, with stronger evidence raising the priority.

Similarity is a detector, not a merge decision. A 70–80% match can represent a typo, handwriting confusion, alias, or a genuinely different person. Human confirmation remains required before merge or identity reassignment.

## Name reading
ARIA reasons about Nigerian, African and English naming patterns, including diverse Nigerian regional patterns and other African naming conventions. An unfamiliar name is not an error. Human corrections can teach recurring organization-specific aliases/handwriting patterns and generalized visual confusions, but the current image always outranks learning.

## Phone reading
Every visible digit is read literally. Nigerian formatting is sanity-checking only. Nigerian mobile numbers are expected to use local prefixes in the `070–079`, `080–089` or `090–099` ranges when represented locally. Invalid prefixes are evidence requiring review; they are never silently rewritten from `020` to `070` (or any other prefix) merely because the replacement looks plausible.

Extra/missing/ambiguous digits, continuation uncertainty and row ownership uncertainty enter Review Center. Raw observations remain available for comparison.

## Multi-phone rule
A person may legitimately have multiple visibly associated phone numbers when the register clearly shows them. Never collapse multiple visible numbers into one, never discard a second number merely because one phone is sufficient for normalization, and never transfer a continuation phone to an adjacent person without physical evidence.

## OCR/HTR integration rule
Future dedicated OCR/HTR systems are additional observers, not truth authorities. OCR output must retain positional information whenever possible. The future flow may become:

`IMAGE → OCR/HTR observers + Qwen observer → physical row/column reconstruction → deterministic validation → identity resolution → Review Center/People`

Disagreement is evidence. Preserve competing observations and escalate material disagreement instead of selecting a value solely because it is format-valid.

## Review Center
Review Center contains **scan observations**, not fake people. The dedicated `scan_review_items` table stores raw values, normalized values, evidence, candidates, proposed identity, reasons and resolution state.

Typical reasons include:
- ambiguous/unreadable name;
- ambiguous or corrupted phone digit;
- invalid Nigerian phone prefix;
- continuation/row ownership uncertainty;
- a phone appearing on another scan row;
- one known identity with a conflicting field;
- multiple plausible existing identities;
- learning conflicting with the current image.

Review actions must support confirming an existing identity, correcting fields, creating a genuinely new person, keeping records separate, and discarding the observation. Review records stay outside `people` until a human decision authorizes the relevant write.

## Learning loop
Learning is fed by **human corrections whenever they happen**, not only immediately after a scan. A scan can remain pending in Review Center while the user waits to correct it later.

When a human correction resolves a review item, NYEOCARE may record:
- an organization/person-specific alias or observation;
- a generalized visual confusion pattern;
- a generalized phone-digit confusion pattern;
- the source review and person involved.

Private identity facts and phone numbers must not be promoted into global learning. Learned hints can appear inside Review Center and inform future observations, but learned data never outranks the current register image.

## Confidence and evidence
Confidence is evidence, not truth. If a source does not actually provide a confidence value, NYEOCARE stores `null` rather than inventing a number. Evidence classes, alternatives, coordinates and explicit flags remain more important than a decorative score.

## Verification state
Extraction success, identity resolution and human verification are separate states. A person can be recognized from strong existing evidence without a new person being created. Human review explicitly records confirmation or correction.

## Regression requirements
Every future Scan implementation or model change must preserve at least these cases:
1. Sandra's continuation phone `08183488629` remains attached to Sandra.
2. Two phones for one person remain two phones.
3. The next person's phone is never borrowed by the preceding person.
4. Ambiguous digits remain ambiguous rather than being silently corrected.
5. `020...` is flagged rather than blindly converted to `070...`.
6. Exact known identities are recognized even when a separate field is ambiguous.
7. Two people with the same name but different identities do not auto-merge.
8. Close name similarity around 70–80% is detected for review.
9. Review observations are never inserted into `people` as placeholders.
10. A later human correction feeds the learning loop.
11. The original image remains the source of truth for disputes.

## Safety
Failed scans do not partially mutate People. Review actions are transactional. Active phone collisions are blocked. Similarity alone never authorizes an automatic merge.
