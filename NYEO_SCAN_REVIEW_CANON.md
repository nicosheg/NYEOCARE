# NYEOCARE — Canonical Scan & Review Contract

## Core principle
ARIA may use model confidence because the vision model sees the current register. The score is treated as visual evidence, not truth. The deterministic regulator combines model confidence, explicit visual evidence states, phone/row structure and identity conflicts. Missing scores do not become zero.

## Physical row and geometry are authoritative evidence
The physical register is not a flat text stream. Preserve top-to-bottom row order, column alignment, indentation, vertical spacing, continuation lines and other visible connectors between names and phone numbers.

A phone on a blank continuation line belongs to the preceding person when the image provides clear physical evidence that it continues that person's phone field. Do not shift that number to the next named person merely because the next name is visually closer in OCR text order.

### Canonical Sandra benchmark
The Carrillion handwritten-register benchmark contains a critical continuation case:
- **Sis Sandra Isiche/Isichei** owns **two phone numbers**.
- The second number, `08183488629`, is written on the continuation line immediately beneath Sandra's row and remains aligned with Sandra's phone column.
- The next named person is **Sis Tonia Isichei**, whose phone is `08165264100`.
- Therefore `08183488629` must remain attached to Sandra and must never be shifted to Tonia.

The successful Qwen vision extraction demonstrated the required behavior: it returned Sandra with both `08039579786` and `08183488629` and explicitly cited the second number's vertical position and phone-column alignment as the evidence for ownership. This behavior is a required regression case for future scan prompts, validators and OCR/HTR integrations.

## Name reading
ARIA reasons about Nigerian, African and English naming patterns, including diverse Nigerian regional patterns and other African naming conventions. An unfamiliar name is not an error. Human corrections can teach recurring organization-specific aliases/handwriting patterns and global generic visual confusions, but the current image always outranks learning.

## Phone reading
Every visible digit is read literally. Nigerian formatting is sanity-checking only. Extra/missing/ambiguous digits, continuation uncertainty and row ownership uncertainty enter Review Center. A number is never repaired merely to become format-valid.

## Multi-phone rule
A person may legitimately have 0–2 or more visibly associated phone numbers when the register clearly shows them. Never collapse multiple visible numbers into one, never discard a second number merely because one phone is sufficient for normalization, and never transfer a continuation phone to an adjacent person without visual evidence.

## OCR/HTR integration rule
Future dedicated OCR/HTR systems are character-recognition observers, not final truth authorities. OCR output must retain positional information whenever possible. The preferred future flow is:

`IMAGE → OCR/HTR + positional evidence → physical row/column reconstruction → Qwen visual verification → deterministic validation → identity resolution → Review Center/People`

Qwen may resolve layout, continuation and name-phone relationships, but it must not silently repair uncertain characters. When OCR/HTR and Qwen disagree, preserve both observations and escalate the disagreement instead of selecting a value solely because it is format-valid.

## Review Center
Only genuine low-confidence or explicit ambiguity/conflict enters the queue: low name/phone/pair visual confidence; unreadable/ambiguous fields; suspicious phone-digit flags; shared phones; row conflicts; identity conflicts. Clean extraction with missing confidence metadata does not enter review.

## Learning
Human review creates durable learning. Organization scope may preserve exact aliases/observed spellings tied to the organization/person. Global scope must contain only generalized visual-pattern learning, never a person's phone number or private identity record. Both scopes can be supplied to future Groq scans as priors. Current pixels always win; conflicts become review evidence.

## Verification state
Extraction success and human identity verification are separate. A clean scan may enter People with `human_verified=false`. Review resolution explicitly marks human verification.

## Regression requirements
Every future Scan implementation or model change must preserve these cases:
1. A continuation phone remains attached to the preceding person when physical alignment supports it.
2. Two phones for one person remain two phones.
3. The next person's phone is not borrowed by the preceding person.
4. Ambiguous digits remain ambiguous rather than being silently corrected.
5. Physical row order is preserved even when OCR text order is imperfect.
6. The original image remains the source of truth for disputes.

## Safety
Failed scans do not partially mutate People. Review actions are transactional. Phone collisions are blocked.
