# NYEOCARE — Living Product & Engineering Spec
**Documentary status date: 14 September 2026**

> **Every Person. Every Story. Remembered.**

This is the current single source of truth for NYEOCARE. It describes what we are building, why we are building it, what is already real, what is deliberately unfinished, and what the product must become. Reality in the repository and database always outranks this document; whenever reality changes, update this file.

---

## 0. THE PURPOSE OF THIS DOCUMENT

Every AI or engineer working on NYEOCARE must read this document before changing architecture or product behavior.

Rules:
- Never fabricate an audit. Confirm findings from the actual current repository/database before calling them confirmed.
- Architecture first: understand the relevant data flow, dependencies, consumers, and failure modes before coding.
- Nicholas owns product vision and final product decisions. ChatGPT/Claude are used for architecture, audit, verification and review. DeepSeek is the primary implementation partner and must implement the frozen direction rather than redesigning it mid-build.
- For major changes: **Architecture Freeze → Dependency Audit → Experience/Implementation Plan → Build → Review.**
- Code delivered for mobile copy/paste must be a complete replacement file, filename/path on line 1, compact but readable.
- Do not silently expand scope. If a feature changes the truth model, identity model, attendance model, auth, or navigation, stop and audit first.

---

# 1. WHAT NYEOCARE IS

NYEOCARE is a **Relationship Intelligence Platform** for organizations that care about people.

We are starting with churches in Nigeria because the problem is immediate and understandable: organizations meet people, collect names and phone numbers, see people attend, speak with them, notice when they disappear, and still lose the continuity of those relationships.

NYEOCARE exists to preserve that continuity.

The product is not primarily a church-management database, attendance counter, mass-messaging tool, or chatbot. Those are supporting mechanisms.

### The real product
**Institutional relational memory.**

NYEOCARE should allow an organization to move from:

**“We know this name.”**

to:

**“We understand this person's history, what has happened recently, what we actually know, what we do not know, and what would be wise to do next.”**

ARIA is the intelligence layer that turns that accumulated evidence into restrained understanding and useful action.

---

# 2. THE END GOAL

### Mission
> **No person an organization cares about is ever quietly forgotten.**

The outcome should be visible, felt, and provable every week.

### Product promise
NYEOCARE should continuously connect four things:

1. **People** — who the organization knows.
2. **Evidence** — what actually happened.
3. **Memory** — what has accumulated over time.
4. **Care** — what deserves attention next.

The long-term loop is:

```text
PEOPLE
  ↓
EVIDENCE
  ↓
MEMORY
  ↓
UNDERSTANDING
  ↓
CARE DECISION
  ↓
HUMAN ACTION
  ↓
OUTCOME
  ↓
MORE MEMORY
  ↓
BETTER FUTURE UNDERSTANDING
```

This is the moat. Features are replaceable; trustworthy accumulated relational memory is not.

---

# 3. ARIA — THE INTELLIGENCE MODEL

ARIA is not meant to behave like a generic chatbot sitting beside the database.

ARIA should become a **director of evidence and care**:

```text
OBSERVERS / SYSTEMS
       ↓
     EVIDENCE
       ↓
   ARIA DIRECTOR
       ↓
  LIVING TRUTH STATE
       ↓
 EXPLANATION / RECOMMENDATION
       ↓
 HUMAN DECISION / ACTION
       ↓
     OUTCOME
       ↓
     MEMORY
```

Observers should produce evidence. ARIA combines evidence, weighs it, identifies conflicts and decides conservatively what the organization can reasonably say is true.

### Fact / observation / hypothesis discipline
ARIA must distinguish:
- **FACT:** directly established data.
- **OBSERVATION:** what the system observed happening.
- **HYPOTHESIS:** a possible explanation that needs human/contextual confirmation.

Example:
- Correct: “John was not recorded as present today.”
- Not justified after one session: “John normally attends and has suddenly disappeared.”
- Correct next step: “Would you like to check in with John?”

If a person says they travelled, that human context becomes evidence and should alter future reasoning. ARIA must not invent a reason for an absence.

### Living Truth
Current states:
- `alive` — current evidence supports the identity/truth.
- `needs_decision` — evidence is insufficient; human review is needed.
- `conflict` — evidence points to competing interpretations.

Living Truth is persistent internal state, not a marketing confidence score.

---

# 4. THE CORE DATA / CARE LOOP

```text
SCAN
  ↓
IDENTITY RESOLUTION
  ↓
PEOPLE
  ↓
ATTENDANCE SESSION
  ↓
HUMAN OBSERVATIONS
  ↓
CONFIRMED PARTICIPATION
  ↓
ENGAGEMENT + RELATIONSHIP INTELLIGENCE
  ↓
ARIA OBSERVATIONS
  ↓
CARE QUEUE / DAILY BRIEFING
  ↓
RECOMMENDATION
  ↓
HUMAN APPROVAL
  ↓
ACTION / OUTCOME
  ↓
PERSON JOURNEY + MEMORY
```

Every state transition must remain traceable.

---

# 5. SCAN — CURRENT CONTRACT

Scan is **population capture and identity resolution**, not attendance.

### Non-negotiable
**SCAN ≠ ATTENDANCE ≠ PARTICIPATION.**

A paper register can be historical, incomplete, belong to another department, or contain people who were not present that day. Scanning it must never create attendance or participation automatically.

### Physical register is the extraction unit
The physical row is the fundamental unit. Extraction must preserve:
- original name/title spelling where readable;
- original phone digits;
- multiple phones when visibly assigned to one row;
- continuation rows when a phone clearly belongs to the preceding person;
- physical relationships such as continuation/visual linkage when visible.

Never invent unreadable digits or attach a nearby number merely because it is close.

### Current scan hardening
The vision pipeline has been hardened for difficult captures including:
- sideways/rotated pages;
- upside-down pages;
- 90/180/270-degree orientation;
- skew and perspective distortion;
- cropped edges;
- folds and rumpled paper;
- stains and dirty paper;
- shadows and glare;
- ink bleed;
- difficult handwriting;
- blank continuation rows;
- two phones attached to one person.

The current strategy uses independent vision reading/audit passes rather than making one huge schema do everything. Disagreement must produce uncertainty rather than hallucinated certainty.

### Real-register scan benchmark — September 2026
A real Carrillion handwritten register was used as a controlled benchmark because it contains difficult handwriting, Nigerian phone numbers, titles/prefixes, and a continuation phone number.

Observed benchmark structure:
- **22 people/rows**.
- **23 phone-number observations**, because Sandra has two numbers and the second number is written on the following continuation line.
- The continuation number must remain attached to Sandra rather than being assigned to the next named person.

The hardened v71 full-page observer successfully extracted the register structure without the earlier catastrophic semantic field swap. In the audited result, the field-level result was approximately **93.3% exact** across the combined name + phone fields: **42/45 exact fields** (22 names + 23 phone values). The phone side was **23/23** on that benchmark; the remaining discrepancies were handwritten-name transcription issues, including small title/name readings such as `Sus` instead of the handwritten `Sis`.

Two consecutive scans of real registers were also observed to complete successfully without unnecessary review/error behavior. This is evidence that the current pipeline is behaving more reliably in practice, but it is **not** a universal accuracy guarantee; every new register remains subject to deterministic validation and review when the pixels are genuinely ambiguous.

### Why the scan currently avoids unnecessary errors
The scan architecture deliberately separates responsibilities:

```text
FULL-PAGE Qwen OBSERVATION
        ↓
EXPLICIT NAME / PHONE SCHEMA
        ↓
PHYSICAL ROW RECONSTRUCTION
        ↓
DETERMINISTIC VALIDATION
        ↓
IDENTITY EVIDENCE / REVIEW
        ↓
SAFE PERSISTENCE
```

The important hardening choices are:
- The model reads the **entire page first**, top-to-bottom, instead of blindly treating arbitrary crops as independent people.
- The vision contract uses explicit fields such as `name`, `phones`, `name_evidence`, `phone_evidence`, and `row_evidence` instead of cryptic keys that previously encouraged semantic field swaps.
- The prompt explicitly forbids putting a phone number in `name`, or a name in `phones` / evidence notes.
- Physical placement, row lines, indentation and continuation layout determine name-to-phone ownership; proximity alone is not enough.
- A blank continuation line can contribute a second phone to the preceding person only when the physical layout supports it.
- The model is not allowed to invent, autocomplete or silently repair unreadable digits/names.
- Identity resolution is downstream from observation, so uncertain handwriting does not become an automatic database merge.
- Review is generated only when deterministic evidence says a human decision is actually needed.
- A small deterministic v72 cleanup now handles only highly constrained common handwritten honorific variants such as `Sus` → `Sis`; it does **not** perform broad fuzzy name rewriting.
- Raw observations remain conceptually separate from later identity decisions and learning.

This is the definition of a “flawless” scan **case** in the current architecture: not that every handwritten character is magically readable, but that the system extracts what is visible, preserves physical ownership, avoids inventing information, and surfaces only genuine uncertainty. The benchmark above demonstrates that behavior on this register; future registers must still be measured independently.

### Accuracy ceiling and safe-improvement rule
The current benchmark does **not** justify claiming 98–99% field accuracy yet. The observed combined result is approximately 93.3%, and the safest current improvement path is constrained cleanup/validation rather than aggressive autocorrection. Broad fuzzy correction could make an apparently cleaner result less truthful and could damage uncommon Nigerian names.

Therefore the scan must prefer:

**93% truthful extraction + honest review**

over

**98% apparent extraction produced by unsafe guessing.**

Future improvements toward 98–99% should come from additional evidence, better vision observation, regression-tested deterministic validation, or human corrections that become reusable learning — never from silently guessing ambiguous handwriting.

### Identity evidence
Strongest evidence is a compatible combination of name + phone(s). Other evidence can be reviewable, but neither a phone alone nor a fuzzy name alone is sufficient justification for a merge.

Shared phone numbers are evidence, not automatic identity.

### Scan safety principle
If the pixels genuinely do not contain enough information, the correct result is **uncertain**, not a fabricated answer.

---

# 6. ATTENDANCE / PARTICIPATION — LOCKED MODEL

This is one of the most important architectural rules in NYEOCARE.

```text
SCAN
 ↓
PEOPLE
 ↓
ATTENDANCE SESSION
 ↓
USERS RECORD WHO THEY SAW
 ↓
ADMIN / OWNER REVIEW
 ↓
CONFIRMED PARTICIPATION
 ↓
ENGAGEMENT INTELLIGENCE
 ↓
CARE
```

### Attendance states
- **Present** — observed and/or confirmed.
- **Unobserved** — not marked; never automatically treated as absent.
- **Confirmed Absent** — only after sufficient coverage and explicit authorized review.

There is no “Absent” button for ordinary users. Users record who they saw.

### Current processing behavior
Saving a session commits the attendance first. ARIA participation processing runs after the save response and has a durable lifecycle on the session (`pending` → `processing` → `completed` or `failed`). A processing failure must never roll back or hide saved attendance. The failure remains retryable from the persisted session, and the UI must surface the processing state without treating ARIA as part of the database commit itself.

Participation records are idempotent per organization/person/session/attendance type.

After confirmed attendance, the system:
- creates participation history;
- updates engagement metrics;
- updates relationship intelligence;
- emits a participation event;
- lets ARIA observe the event;
- evaluates the completed session for people not recorded present;
- creates a conservative absence observation/action when appropriate.

### First-session absence
A first absence is an **immediate signal**, not a historical pattern.

ARIA may recommend a lightweight check-in, but it must not pretend to know why the person was absent.

---

# 7. LAST ATTENDED — PRODUCT TRUTH

The People card must show **Last attended** using actual confirmed attendance/participation history.

The authoritative history is `participation_records.occurred_at` for attendance participation. Engagement metrics derive `first_seen` and `last_seen` from that history.

Therefore:
- scanning someone does not update Last attended;
- adding a person does not update Last attended;
- merely opening a profile does not update Last attended;
- only real confirmed participation should advance it.

The People API exposes this as `last_attended_date`, and the People card should render it compactly.

If there is no confirmed participation, the UI should show an honest empty state rather than invent a date.

---

# 8. PEOPLE PAGE — CURRENT UX CONTRACT

The People page is a calm directory, not an analytics dashboard.

### Card should show only
1. **Name**, including meaningful human prefix/title such as `Sis`, `Bro`, `Mrs`, `Pastor`, etc.
2. **Living Truth dot** — persistent small dot beside the name; no explanatory text on the card.
3. **Visitor / Member tag** — compact and human-readable.
4. **Phone number.**
5. **Last attended** from real participation history.

### Card should NOT show
- confidence percentage;
- confidence explanation;
- email;
- birthday;
- long Living Truth explanations;
- relationship/engagement analytics;
- unnecessary profile metadata.

Those belong in the person's Journey/profile experience.

### Design expectation
Cards should be compact but content-adaptive — not artificially tall and not crushed. The user should understand the person at a glance and naturally tap into the Journey for depth.

The UI should feel premium, quiet, warm and alive rather than like a spreadsheet.

---

# 9. PERSON JOURNEY — WHERE DEPTH LIVES

The Journey is the deep view of a person.

It should eventually answer:
- Who is this person?
- How did we first know them?
- What have we actually observed?
- When did they attend?
- What conversations/context do we remember?
- What care has happened?
- What did the person tell us?
- What outcomes followed?
- What does ARIA currently believe?
- What remains uncertain?
- What deserves attention next?

Potential journey layers:
- identity and aliases;
- first encounter / registration;
- attendance history;
- participation patterns;
- follow-up/contact history;
- notes;
- prayer/care context;
- birthdays/milestones;
- conversations;
- ARIA observations;
- recommendations and decisions;
- human actions and outcomes.

Every meaningful action should leave a trace in the Journey/timeline.

---

# 10. DAILY BRIEFING / ARIA TODAY

The Home experience is **ARIA Today**.

The purpose is not to dump explanations on the user. It is to tell the user what deserves attention without exhausting them.

### Current UX direction
Similar briefing items are grouped into compact categories such as:
- **SCAN REVIEW** — register/identity review.
- **FOLLOW-UP** — people worth checking in on.
- **OTHER THINGS WORTH ATTENTION** — other actionable items.

Users first see the group, count and short meaning. Detailed explanations appear only after opening the group/item.

When the user handles an item, the Home briefing should refresh so the same work does not remain stale elsewhere.

### ARIA behavior
ARIA should naturally decide when to be quiet, when to surface something, and how much explanation is necessary. The product should feel like intelligent assistance, not a notification machine.

---

# 11. CARE / ACTION MODEL

ARIA can:
- observe;
- explain;
- recommend;
- prepare drafts;
- identify context;
- learn from human corrections/outcomes.

ARIA cannot autonomously execute real-world actions.

### Human control is permanent
Every consequential action requires explicit human approval before execution.

No hidden:
- auto-send;
- auto-approve after repeated success;
- autonomous messaging;
- autonomous campaign execution.

### Messaging today
Real provider integration is not the current dependency. The safe interim path is:

```text
ARIA recommendation
 ↓
ARIA draft
 ↓
HUMAN REVIEWS / EDITS
 ↓
HUMAN SENDS
 ↓
SEND CONFIRMATION
 ↓
TIMELINE / JOURNEY
```

The system must never mark a message as sent merely because a draft was generated or a WhatsApp link was opened.

---

# 12. MEMORY & LEARNING

The long-term goal is not simply storing rows. It is accumulating reliable context.

Memory should preserve:
- raw evidence where appropriate;
- observations;
- human corrections;
- context;
- actions;
- outcomes;
- relationship history;
- identity evolution.

Current foundations include person timeline/journey events, ARIA observations, intelligence state, care actions, communication history and learning structures.

### Future intelligence loop
```text
ARIA recommendation
 ↓
Human response
 ↓
Outcome
 ↓
Learning signal
 ↓
Better recommendation next time
```

Active learning and richer voice/pattern learning remain future phases; the data foundation should not block them.

---

# 13. CURRENT TECHNICAL ARCHITECTURE — 14 SEPTEMBER 2026

### Application
- Next.js **14.1.0**.
- React **18.2.0**.
- Pages Router with API routes under `pages/api/`.
- Mobile-first web experience.
- Capacitor/Android workflow exists for future native packaging.

### Database
- PostgreSQL through Supabase infrastructure.
- Server-side database access uses the `pg` library and SQL.
- Supabase Auth provides authentication.
- Organization identity comes from authenticated server context, not client-supplied organization IDs.

### AI
- Groq is the current vision provider.
- Scan extraction is protected by controlled output budgeting, strict validation and safe failure behavior.
- Vision extraction is intentionally separated from identity resolution and downstream care intelligence.

### Hosting
- Production deployment direction is **Vercel**.
- Render remains historical/fallback context, not the primary current hosting target.

### Repository
- GitHub repository: `nicosheg/NYEOCARE`.
- Current branch: `main`.

---

# 14. CURRENT REPOSITORY STATE

### Navigation / product structure
Current product direction is consolidated around:
- **Home** — ARIA Today / briefing / care.
- **People** — people directory with Attendance and Review Center experiences.
- **Profile** — organization profile/settings.

Legacy filenames/routes may remain for compatibility. Do not rename or delete compatibility files casually.

### Important modules currently in the architecture
- `lib/aria/eventProcessor.js` — ARIA event processing.
- `lib/aria/observationEngine.js` — observations and evidence.
- `lib/aria/recommendationEngine.js` — proposed/approved/executed action lifecycle.
- `lib/aria/draftEngine.js` — care message drafting.
- `lib/aria/participationGenerator.js` — confirmed attendance → participation/intelligence/absence processing.
- `lib/aria/engagementIntelligence.js` — attendance-derived engagement metrics.
- `pages/index.js` — ARIA Today/Home experience.
- `pages/people.js` — People experience.
- `pages/api/people.js` — organization-scoped People API.
- `styles/people-sizing.css` — current compact People-card presentation.
- `lib/aiProvider.js` — vision extraction/provider orchestration.
- `lib/scanValidation.js` — deterministic scan validation/name/prefix/continuation handling.
- `lib/visionProcessor.js` — scan processing and identity-resolution pipeline.

---

# 15. DATABASE STATE OBSERVED DURING THE CURRENT BUILD CYCLE

The live development Supabase project was audited during this cycle.

Observed state included:
- **22 active people** after the audited register scan.
- **17 confirmed participation records**.
- **17 participation observations** plus **5 absence observations**, for **22 ARIA observations**.
- Missing person intelligence/state/engagement records discovered for first-session absences were repaired.
- All 22 active people were brought to a consistent baseline of engagement metrics, people intelligence and ARIA person state.
- The audited scan job contained **22 extracted / 22 valid** records with two review-sensitive identity cases before the manual image audit; one 12-digit phone remained quarantined for confirmation rather than being silently normalized.

These numbers describe the development data observed during this cycle, not a universal production guarantee.

---

# 16. IMPORTANT SCAN AUDIT HISTORY

The current scan pipeline has been hardened because several real failures exposed what must not happen.

### Failure: wrong phone assignment
The biggest practical scan risk is assigning a nearby phone to the wrong person. Name-only confidence is unacceptable.

### Failure: schema overload
When row numbers, multi-phone relationships and relationship classification were all forced into one vision response, extraction quality degraded sharply. The architecture therefore prefers focused passes and deterministic validation.

### Failure: stale completed-image cache
Completed-image caching could return old results instead of respecting current identity state. The unsafe cache branch was removed so repeat scans use current extraction/identity resolution.

### Failure: continuation rows
A phone on a blank ruled continuation line can belong to the preceding named person. Deterministic coalescing now handles this when the physical layout supports it.

### Failure: titles/prefixes disappearing
Titles such as `Sis`, `Bro`, `Mrs`, `Pastor`, etc. are meaningful display information. Validation and display logic must preserve them while identity normalization can still remove them when appropriate for matching.

---

# 17. CURRENT ENGINEERING SAFETY RULES

Before merging a change, check:

- Organization ID comes from authenticated org context, never client input.
- Browser-imported code must never instantiate a service-role Supabase client.
- PostgreSQL SQL matches actual schema and column names.
- JSONB returned by `pg` is not unnecessarily `JSON.parse()`d again.
- Name matching uses normalized/whole-word-aware logic where required; never dangerous substring checks.
- AI output is strict JSON-or-abort; reasoning text must never leak into the database.
- Identity merges require evidence; fuzzy similarity is not proof.
- Shared phones are not automatic merges.
- Scan never creates attendance.
- Unobserved never automatically means absent.
- Participation is created only from confirmed attendance.
- Every consequential action stays human-approved.
- Errors expose useful `error.message` information to developers rather than silently becoming `{}`.
- Security-definer functions are intentionally reviewed because they are privileged database surfaces.
- Do not blindly add indexes simply because an advisor lists foreign keys; consider real query patterns and current scale.

---

## 17A. CRITICAL-CLIENT FAILURE / FIXING PROCEDURE

A client-side error on a critical NYEOCARE surface is an engineering incident, not a cosmetic UI issue. A green production build proves compilation; it does **not** prove that the live client can render the actual state returned by the database.

When the user sees the NYEOCARE client-error recovery screen:

1. **Stop the feature test.** Do not continue changing code while reproducing the same incident.
2. **Preserve the exact state.** Record the route, exact user action, whether attendance was already saved, the visible message, timestamp, and current deployment/commit.
3. **Capture the exact client exception.** The error boundary must log and report `message`, stack, React component stack, route, and surface to the server-side diagnostic endpoint. Do not rely on the generic recovery text as the diagnosis.
4. **Check production telemetry first.** Inspect Vercel runtime errors/logs for the same window. Server-side API failures and client-render failures are different failure classes; do not infer one from the other.
5. **Trace root cause through the full state path.** For attendance, inspect: authenticated session → active/closed session payload → people payload → normalization → render branch → event handler → persistence API → ARIA processing. Verify actual response shapes against the current database schema.
6. **Fix the root cause, then add the regression guard.** Every client-render incident must leave behind a deterministic regression check for the failure class. For the attendance modal this includes static validation that every referenced style object exists and that removed parallel context UI does not return.
7. **Isolate critical surfaces.** A render error in Attendance, Scan, Review, or another modal must not blank the entire application. Use a surface-level error boundary so the rest of NYEOCARE remains usable while the failing surface is recovered.
8. **Protect persistence separately from presentation.** Attendance is saved on the server before ARIA processing. A client rendering failure must not be able to delete or roll back already-committed attendance.
9. **Verification gate before promotion:** CI passes; Vercel deployment is `READY`; then run the exact production smoke sequence: open Attendance → create session → load people → mark/unmark → save → observe processing state → reopen/retry if needed → reload page → confirm saved state. Repeat once with an intentionally recoverable processing failure path.
10. **Document recurrence.** Record the commit, exact root cause, regression check, verification result, and any remaining uncertainty in the engineering history. Never call a build “fixed forever” merely because it compiled once; the release is considered hardened only after the regression case passes.

### Attendance-specific regression requirements

The attendance surface must remain:

**open safely → render safely → record safely → save durably → process independently → recover visibly.**

The following are non-negotiable:
- malformed or incomplete attendance API payloads are normalized or rejected before render;
- stale concurrent loads cannot overwrite newer attendance state;
- a slow ARIA process cannot block the attendance database commit;
- a failed ARIA process is retryable and idempotent;
- a client render error cannot replace the whole application with the generic global screen;
- the exact client exception is observable to engineering;
- the corresponding failure class has a CI regression check before another feature is layered onto the surface.

# 18. CI / DEPLOYMENT STATUS

A GitHub Actions CI workflow now exists and uses pinned action SHAs.

The CI workflow now supplies non-production build-time Supabase placeholders. The latest main-branch CI run on 19 September 2026 completed successfully, including scan regression and `next build`. CI status must still be checked on every new critical-path change.

Android workflow is also present with pinned GitHub actions and a repository `NYEOCARE_URL` variable.

---

# 19. SECURITY / OPERATIONS DEBT

Known items that are not to be confused with product correctness:

- Some RLS-enabled private/server tables currently have no policies because they are intentionally accessed through server-side privileged paths; these must be reviewed deliberately rather than opened merely to silence an advisor.
- Several SECURITY DEFINER helper functions require continued hardening/review of grants and search paths.
- Supabase leaked-password protection should be enabled before real production launch.
- Real SMTP should be connected before heavy production authentication use.
- Real WhatsApp/Termii provider integration remains a later operational step.

---

# 20. WHAT “GOOD” LOOKS LIKE

NYEOCARE is successful when a real organization can do this naturally:

### Before service
ARIA knows the organization and people it has been entrusted with and surfaces only what matters.

### During service
People record who they actually saw. The system does not force users to declare who was absent.

### After service
The session closes into trusted participation history. ARIA immediately sees meaningful evidence and produces restrained next-step recommendations.

### Later that week
A person who needs care is not lost in a spreadsheet. Their context, history and previous actions are available in Journey.

### Months later
The system knows enough history to distinguish a one-off absence from a meaningful pattern. It can explain why it is recommending something without pretending certainty it does not possess.

### Over years
The organization has an institutional memory of its relationships that does not disappear when a volunteer leaves, a leader changes, or a spreadsheet gets lost.

That is the actual destination.

---

# 21. CURRENT PHASE — SEPTEMBER 2026

We are beyond basic UI prototyping. The foundation of the production architecture exists and is now being hardened around the real loop.

### Completed / substantially established
- Auth and organization isolation.
- Consolidated Home / People / Profile direction.
- Scan extraction + deterministic validation.
- Multi-phone and continuation-row handling.
- Identity review/Living Truth foundations.
- Attendance session lifecycle.
- Confirmed participation generation.
- Engagement intelligence foundation.
- ARIA observation engine.
- Recommendation/action lifecycle.
- Human-approved draft/action model.
- First-session absence observation/action.
- Daily Briefing grouping and compact attention UX.
- People prefix preservation.
- Compact People-card design.
- Confidence removed from user-facing People cards.
- Visitor/Member tag restored.
- Last-attended field wired from attendance-derived intelligence and current card visibility being hardened.
- CI and Android workflows established with pinned action references.
- Current Vercel deployment direction.

### Current immediate priorities
1. **Verify the People card against real attendance history:** a confirmed participation date must visibly appear as Last attended, and it must update after a genuine attendance session closes.
2. **Finish functional verification of the complete attendance → participation → ARIA → briefing loop.**
3. **Make Person Journey the authoritative deep view** while keeping People cards intentionally simple.
4. **Verify Review Center with deliberately ambiguous identity/phone cases.**
5. **Verify daily briefing state updates after the user handles an item.**
6. **Fix CI environment configuration and obtain a genuinely green build.**
7. Continue hardening before adding large new feature surfaces.

---

# 22. NEXT PHASES

### Phase A — Harden the current loop
- People → Attendance → Participation → Last attended.
- Review Center correctness.
- Daily Briefing correctness.
- Journey timeline correctness.
- Error/retry/idempotency testing.

### Phase B — Make ARIA genuinely relational
- richer person memory;
- human context ingestion;
- care feedback;
- action outcomes;
- repeated-session pattern detection;
- restrained proactive suggestions;
- stronger explainability.

### Phase C — Scale intelligence
- Church Voice Learning;
- Pattern Learning;
- multi-user real-time attendance;
- section-based assignment;
- deeper workflow automation while preserving human approval;
- richer Living Environment;
- real messaging provider integrations.

### Future expansion
The same underlying relationship-intelligence engine should eventually support schools, NGOs, hospitals and other membership organizations through a vocabulary/domain layer rather than rebuilding the core intelligence from scratch.

---

# 23. DESIGN CONSTITUTION

1. Motion must explain, never decorate.
2. ARIA speaks only when useful — never nags.
3. Every meaningful action leaves a trace in the Journey/timeline.
4. People stay in the foreground; technology recedes.
5. Clarity comes before effects.
6. The interface rewards attention instead of demanding it.
7. Screens should feel alive even with little or no data.
8. Every interaction should make the user more capable, not more overwhelmed.
9. If removing an effect would not be noticed after a week of daily use, it probably was not necessary.

### Current visual world
- Deep navy / near-black base.
- Night Sky with slow atmospheric cloud movement.
- Warm gold accents.
- Soft emissive glow from meaningful elements.
- True glass/metaball treatment for connected navigation elements where appropriate.
- No harsh neon.
- No decorative emoji in core product UI.
- Generous negative space.
- Calm, premium, human-first motion.

---

# 24. THE FINAL PRODUCT TEST

Before calling a major feature “done”, ask:

> **Does this make NYEOCARE better at remembering and caring for a real human being — with evidence strong enough that we can trust the result?**

If the answer is no, the feature is noise.

If the answer is yes but the system cannot explain where the information came from, the feature is unsafe.

If the answer is yes and the evidence is trustworthy but the interface overwhelms the user, the feature is unfinished.

The goal is not to build the most features.

**The goal is to build an intelligence an organization can trust with the continuity of its relationships.**

---

## Documentary record
**Last updated:** 18 September 2026

This edition supersedes stale assumptions in earlier versions, especially around hosting, People-card presentation, attendance-derived Last attended, current scan hardening, current ARIA action safety, daily briefing behavior, and the current production-hardening phase.

**Current canonical product name in this repository:** NYEOCARE.
