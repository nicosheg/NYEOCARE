# NYEOCARE — Canonical Scan & Review Contract

## Core principle
ARIA may use model confidence because the vision model sees the current register. The score is treated as visual evidence, not truth. The deterministic regulator combines model confidence, explicit visual evidence states, phone/row structure and identity conflicts. Missing scores do not become zero.

## Name reading
ARIA reasons about Nigerian, African and English naming patterns, including diverse Nigerian regional patterns and other African naming conventions. An unfamiliar name is not an error. Human corrections can teach recurring organization-specific aliases/handwriting patterns and global generic visual confusions, but the current image always outranks learning.

## Phone reading
Every visible digit is read literally. Nigerian formatting is sanity-checking only. Extra/missing/ambiguous digits, continuation uncertainty and row ownership uncertainty enter Review Center. A number is never repaired merely to become format-valid.

## Review Center
Only genuine low-confidence or explicit ambiguity/conflict enters the queue: low name/phone/pair visual confidence; unreadable/ambiguous fields; suspicious phone-digit flags; shared phones; row conflicts; identity conflicts. Clean extraction with missing confidence metadata does not enter review.

## Learning
Human review creates durable learning. Organization scope may preserve exact aliases/observed spellings tied to the organization/person. Global scope must contain only generalized visual-pattern learning, never a person's phone number or private identity record. Both scopes can be supplied to future Groq scans as priors. Current pixels always win; conflicts become review evidence.

## Verification state
Extraction success and human identity verification are separate. A clean scan may enter People with `human_verified=false`. Review resolution explicitly marks human verification.

## Safety
Failed scans do not partially mutate People. Review actions are transactional. Phone collisions are blocked. 
