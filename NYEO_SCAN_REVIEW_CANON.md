# NYEOCARE — Canonical Scan & Review Contract

## Core principle
ARIA may use model confidence because the vision model actually sees the register, but confidence is evidence, not truth. The final decision is deterministic: model evidence + explicit visual flags + structural validation + identity/phone conflicts.

## Name reading
ARIA recognizes Nigerian, African and English naming patterns. Unfamiliar names are not errors. A model suggestion is not ground truth. Human review is required only when there is genuine letter-level ambiguity, corrupted text, explicit low name evidence, or a learned-example conflict with the current image.

## Phone reading
Digits are treated literally. Nigerian formatting is only a sanity check. Missing, extra, ambiguous or suspicious digits trigger review. The system never repairs a model reading merely to produce a plausible phone number.

## Pairing
Name-to-phone ownership follows the physical page. Ambiguous row ownership triggers review. Second phones require visual support.

## Confidence
When Groq supplies `nc`, `pc`, or `rc`, the local regulator accepts those scores as model visual evidence. It does not invent missing scores. Current thresholds: name <75, phone <85, pair <80.

## Learning
Human corrections are stored as durable identity observations and may be used as priors for future extraction at both organization and global scope. They never override the current pixels. A current image conflict becomes review evidence rather than silent correction.

## Review Center
Only unresolved scan evidence/conflicts and database duplicate groups appear. Clean extraction with no low-confidence/ambiguity/conflict evidence remains outside Review Center. Human verification is distinct from extraction success.

## Safety
Failed or invalid scans do not partially mutate People. Review resolution is transactional. Phone collisions are blocked. Human corrections are retained as future learning evidence.
