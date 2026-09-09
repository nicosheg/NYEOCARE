NYEOCARE — Living Spec

Single source of truth. Update when reality changes.

0. RULES

- Before implementation: inspect relevant current code/schema → explain understanding + plan → wait for confirmation → implement.
- Never fabricate audits/findings. Confirm from actual current files/DB.
- Reality wins over this document.
- Nicholas = vision/final decision. ChatGPT/Claude = architecture/audit/review. DeepSeek = implementation only.
- Large changes: Architecture Freeze → Dependency Audit → Plan → Build → Review.
- No autonomous external actions: ARIA may observe/explain/recommend/prepare, but every action requires explicit human approval.

1. MISSION

«Every Person. Every Story. Remembered.
NYEOCARE helps organizations know their people, remember their journeys, and care intentionally. Starts with Nigerian churches; architecture extends to schools, NGOs, hospitals and membership organizations.
Filter: if it does not help someone care for another human better, it does not belong.»

2. CORE ARCHITECTURE

Evidence → Extraction → Validation → Identity → Memory → Intelligence → Recommendation → Human Approval → Action

ARIA distinguishes observation, inference and recommendation. Uncertainty must never become fact.

3. SCAN

Scan = population/identity capture only.

SCAN ≠ ATTENDANCE ≠ PARTICIPATION

Scan never creates attendance.

Pipeline:

Image → Adaptive Vision → Strict JSON → Row Validation → Name/Phone Verification → Duplicate/Identity Resolution → Review/Accept → Memory

Extraction

The physical register row is the fundamental unit. Each AI object represents one person/row and keeps every phone visibly assigned to that row together.

- Preserve original name/title and original phone digits.
- Support 0/1/2+ phones when visibly assigned.
- Preserve "0"/"+234".
- Never invent or autocomplete unreadable digits.
- Never attach a nearby number without visual evidence.
- Ignore headers, totals, dates and unrelated numbers.

Example:

{"n":"Person Name","p":["08012345678","08123456789"]}

Validation

- Strict JSON-or-abort.
- Normalize names/phones.
- Detect duplicates.
- Preserve raw values.
- Flag invalid/ambiguous records.
- Current max: 50 people/page.
- Validation does not itself establish identity.

4. IDENTITY

Extraction asks “what is physically written?”; identity asks “who is this?”
Confidence must combine evidence, especially the name ↔ phone relationship:

Exact name + exact phone(s) → strongest
Compatible name + phone → high
Phone only → reviewable
Name only → reviewable
Fuzzy name only → weak
Conflicting name/phone → conflict/review

Never merge merely because a phone or name exists somewhere in the organization.

5. TOKEN/PROVIDER MANAGEMENT

Previous failure: Groq rejected "1200" requested output tokens against a "1000" OTPM ceiling. Retrying the same deterministic request was wasteful.

Current architecture:

Provider ceiling → Safety headroom → Safe ceiling → Adaptive budget → Vision request

- Ceiling configurable through "GROQ_SCAN_OUTPUT_CEILING"; current safe default = 1000.
- Adaptive budgets scale with image complexity/size and are always clamped below the safe ceiling.
- Actual usage is logged; "max_completion_tokens" is only an upper bound.
- Deterministic output-limit errors are non-retryable.
- Retry only transient failures (temporary capacity/429 where appropriate, timeout, 408, 5xx).
- Truncated output is not blindly retried.
- Recovery pass may reread a no-result scan with a smaller controlled budget.
- Future paid tiers can raise the provider ceiling without redesigning the pipeline.

Current pipeline version:
"v18-adaptive-scan"

Current model:
"groq-qwen3.8-27b" → "qwen/qwen3.8-27b"

6. SCAN SAFETY

Extract → Validate → Resolve → Verify → Transaction → Commit

Failure = rollback/no corrupted memory.
"scan_evidence" preserves source evidence for verification.
AI reasoning/malformed output must never become database records.

7. REVIEW CENTER

Review is required for unresolved evidence:

- ambiguous identity
- conflicting phones/names
- possible duplicate/merge
- uncertain extraction

Human correction becomes future learning evidence; learning must never silently overwrite truth.

Current status: latest live successful scan produced 22 extracted/accepted, 0 review. Review Center therefore still needs a deliberately ambiguous test before being declared fully verified.

8. ATTENDANCE

Attendance is independent from Scan.
Users mark people they actually observed present. No automatic “absent” assumption.

Observed → Present
Not observed → Unobserved
Human-confirmed → Absent

Confirmed attendance generates participation records and feeds longitudinal intelligence.

9. ARIA

ARIA is the organization's intelligence layer, not merely a chatbot.
It watches:

- people
- attendance/participation
- follow-ups
- relationships
- changes
- care signals
- operator corrections

ARIA should surface what matters, explain why, recommend what to do, and prepare actions for approval.

10. DATABASE/STACK

- Next.js 14.1.0
- API routes: "pages/api"
- PostgreSQL via Supabase + "pg"
- Supabase Auth
- Groq Vision
- Render
- Organization isolation from authenticated "req.org.id"
- "scan_jobs" = scan lifecycle/result
- "scan_evidence" = source evidence
- "people" = person memory
- "aria_learning" = future/active learning evidence
- Keep existing transaction architecture and JSONB behavior.

11. CURRENT VERIFIED SCAN

Latest successful live scan:

22 extracted
22 accepted
0 review
0 rejected
1 attempt
2161 input tokens
604 output tokens
2765 total tokens
HTTP 200
finish_reason = stop
pipeline = v18-adaptive-scan

Live DB currently contains 105 people and 1 scan-evidence record for this scan.

This confirms the adaptive-token scan path is working. It does not yet prove the Review Center/learning loop.

12. FUTURE SCAN

Current:
Single page → extraction → identity → memory

Next:
Multi-page registers
→ cross-page duplicate/identity resolution
→ layout/row/column understanding
→ OCR + vision hybrid
→ targeted crop/zoom rereading
→ evidence bounding/provenance
→ confidence-driven token allocation
→ model routing
→ human corrections → learning
→ scan quality dashboard

Long-term goal:

«Turn messy organizational records into trustworthy organizational memory, not merely OCR text.»

13. KNOWN RISKS

AI can still misread handwriting, ambiguous digits and similar names. Provider limits/capacity can change. Review Center and learning require dedicated testing. Never hide uncertainty behind a percentage.

14. CHECKLIST

Before scan changes:

- [ ] Inspect actual current code/schema.
- [ ] Preserve organization isolation.
- [ ] Strict JSON-or-abort.
- [ ] Preserve physical name/phone relationship.
- [ ] Preserve multiple phones/raw values.
- [ ] Never guess digits.
- [ ] Combine name + phone evidence.
- [ ] Conflicts → review.
- [ ] Scan never creates attendance.
- [ ] Provider request stays within safe ceiling.
- [ ] Output-limit errors are non-retryable.
- [ ] Actual usage is logged.
- [ ] Transactions rollback on failure.
- [ ] No claim of “working/verified” without testing.

15. CORE PRINCIPLE

«NYEOCARE must prefer honest uncertainty over confident falsehood.
The moat is not the vision model. It is:»

Evidence → Correct extraction → Correct relationships → Correct identity → Trusted memory → Longitudinal intelligence
