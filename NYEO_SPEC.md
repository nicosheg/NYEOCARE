# NYEOCARE — Living Product & Engineering Spec
**Documentary status date: 26 September 2026**

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

### People roster last-seen contract
The People roster card's `Last seen` value is sourced from `engagement_metrics.last_seen`, which is the canonical derived observation timestamp. The roster API must project `last_seen` and may fall back to the latest confirmed attendance participation timestamp when the metrics row has not yet materialized. The card must render that API field explicitly; it must not substitute `last_attended_date` under the `Last seen` label.
### People and Journey interaction contract
- The People roster's `Last seen` is the latest confirmed attendance-derived timestamp and is displayed as month + day only.
- The Person Journey displays `Last attendance` from the same canonical attendance truth and `Last interaction` separately.
- `Last interaction` is the latest meaningful direct relational touch known to NYEOCARE: completed/sent/delivered/received person communication or a human/conversation-import timeline event. ARIA drafts, identity-review events, scan-review events, and internal ARIA conversation are not counted as direct interaction.
- ARIA uses `last interaction` operationally to pace proactive care so a recent real touch can suppress unnecessary outreach.
### Client image ingestion contract
Camera capture and gallery/file upload are different **sources**, not different vision pipelines. Before `/api/scan/start` receives an image, both sources must pass through the same deterministic browser preparation path:

```
CAMERA ─┐
        ├→ decode/orient → fit ≤3200px → high-quality JPEG → size guard → /api/scan/start
UPLOAD ─┘
```

The application must not have a fast path that sends small JPEG/PNG/WebP files raw while another source is canvas-normalized. That creates source-dependent pixels and makes scan quality regressions impossible to reason about. The canonical server-side `sharp.rotate() → resize → normalize → sharpen` stage remains in place after upload.

A source may still differ in the **photograph itself** — lighting, focus, framing, perspective and camera quality are physical differences — but once the browser prepares it, the transformation policy must be identical. Any future change to client image preparation must be benchmarked with the same physical register captured once by camera and once through file selection.

### Human attendance correction from ARIA
When a user reviews an attendance-derived care signal, ARIA can accept an explicit human correction:
1. **They attended** → write/update a confirmed attendance record, create/update the attendance participation fact, refresh engagement/relationship/intelligence state, resolve related attendance context, and clear the stale follow-up action.
2. **They did not attend** → write/update a confirmed absence record, remove any attendance participation fact for that session, preserve optional human context, refresh intelligence, clear the stale follow-up action, and prepare a short unsent follow-up draft.
3. The correction is a human historical attendance change and uses the same administrative permission boundary as other historical attendance corrections.
4. A WhatsApp open is never treated as a sent message. Click-to-chat may open WhatsApp with the draft pre-filled, where the user remains responsible for editing and sending it.

### Review queue clearing
Review Center distinguishes evidence that still needs a human decision from evidence the operator intentionally dismisses. Scan review items may be selected individually, including by a mobile long-press gesture, and dismissed in bulk. Bulk dismissal changes the review item to `rejected` with an auditable decision record; it must not delete the original scan evidence, scan job, or person records. Database duplicate groups are never part of scan-review bulk dismissal and retain their dedicated merge/keep-separate workflow.

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

# 13. CURRENT TECHNICAL ARCHITECTURE — 20 SEPTEMBER 2026

### Application
- Next.js **15.5.24**.
- React **18.3.1**.
- React DOM **18.3.1**.
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

### September 19, 2026 recurrence record

The client-error screen reappeared after the attendance context UI was removed. The root cause was a stale render reference: `AttendanceModal.js` still rendered `style={rowActions}` after the context cleanup, but the `rowActions` style declaration had been removed with the old context-related style block. This was a **client-side ReferenceError**, so Vercel server runtime telemetry did not show it and the global error boundary reduced it to the generic recovery screen.

The permanent engineering lesson is that deleting a UI branch must include an explicit dependency sweep for every render reference it owned or exposed. Attendance now has a CI regression guard for undefined style identifiers and removed context remnants, plus a surface-level error boundary and client-error telemetry. The guard must remain mandatory for future attendance changes.

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

## 17B. AUTHENTICATION — PRODUCTION CONFIGURATION CONTRACT

Authentication has two separate concerns that must never be conflated:

**1. Browser authentication target**
- Browser Supabase Auth must point to the canonical production Supabase project.
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are browser-facing configuration values.
- CI may use placeholders for compilation, but placeholder values such as `example.supabase.co` or `ci-placeholder-anon-key` must never be the effective production browser configuration.
- The browser client must persist sessions and automatically refresh them on capable browser runtimes.
- Passive session validation must never call global sign-out.

**2. Server/database target**
- Server-side database access uses the production database connection independently of browser build configuration.
- A mismatch between the server database project and browser Supabase Auth project can make every existing account appear unable to log in even when the Auth records are intact.
- Therefore, authentication incidents must compare the live browser bundle's Supabase target with the canonical production project before changing passwords or users.

### September 22, 2026 authentication incident

The production login failure was traced to a build-time configuration mismatch: the live browser bundle had been compiled with the CI placeholder Supabase URL/key while the real organization/user database remained in the canonical production Supabase project.

Symptoms:
- every existing password account failed;
- the server-side account-diagnosis path could still see the users;
- the login UI initially misclassified any Auth error for an existing email as a wrong-password error.

Permanent safeguards:
- browser auth uses the canonical production Supabase project when a known placeholder configuration is encountered;
- login error handling distinguishes rate limits, unconfirmed email, invalid credentials, missing accounts and other failures rather than collapsing them into “wrong password”;
- auth regression tests guard both persisted-session behavior and placeholder configuration;
- production verification must inspect the deployed JavaScript bundle, not only the Git source, because `NEXT_PUBLIC_*` values are baked into the browser build.

The incident did not require password resets or user deletion. Existing Auth records remained intact.

### Future authentication incident procedure

When login suddenly fails for multiple known accounts:
1. Verify the canonical Supabase project URL.
2. Inspect the live production login bundle for the effective Supabase URL/configuration class.
3. Compare the server-side Auth/database target and browser Auth target.
4. Inspect the actual Supabase Auth error category before changing credentials.
5. Only after configuration and service health are ruled out should account-level credential issues be investigated.
6. After fixing, verify a real existing account can sign in and that the resulting session survives a hard refresh.
7. Keep a regression guard so the exact failure class cannot silently recur.

# 18. CI / DEPLOYMENT STATUS

A GitHub Actions CI workflow exists and uses pinned action SHAs.

During the September 20 production-hardening cycle, the standalone web build exposed a build-time environment dependency during Next.js page-data collection. CI now supplies safe, non-production placeholders through `.github/workflows/web-build.yml` for:

- `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY=ci-placeholder-anon-key`
- `DATABASE_URL=postgres://ci:ci@127.0.0.1:5432/ci`

These are CI-only values. Production Vercel keeps the real production environment variables.

The final production Vercel build completed successfully on the repaired commit. CI status must still be checked on every new critical-path change.

Android workflow is also present with pinned GitHub actions and the repository `NYEOCARE_URL` variable.

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



# 26. SEPTEMBER 26, 2026 — NYEOCARE FIELD MODE / OFFLINE ATTENDANCE

The existing attendance backend was audited before this change. Durable Postgres/PGMQ processing, set-based ARIA stages, organization isolation, session uniqueness, and background processing remain the canonical server architecture. Field Mode adds resilience around that foundation rather than replacing it.

### Implemented
- IndexedDB field session/roster cache.
- Optimistic attendance marks that remain usable during temporary network loss.
- One coalesced pending mutation per person/session, so rapid toggles do not create an outbox storm.
- Automatic reconnect synchronization in batches of 100 changes.
- Server-side batch validation for organization, session membership and active people.
- Closed-session reconciliation for late offline marks, with durable ARIA reprocessing when needed.
- Large field roster endpoint with keyset pagination for pre-service warming.
- Static-asset service worker and installable web-app metadata without caching authenticated HTML.
- Offline fallback page for navigation while disconnected.
- Authenticated bounded performance telemetry for core attendance interactions.
- Regression suite wired into CI as test:field-mode.

### Product behavior
The operator should experience “saved here immediately” rather than a retry loop. Connectivity state is visible but calm. The system automatically syncs when the connection returns. ARIA remains asynchronous and never becomes a gate in the live attendance interaction.

### Intentional boundary
A brand-new attendance session still requires an authoritative online create operation. Offline-first begins once the organization has an active server session and the device has a warmed roster. This avoids inventing a fake local session that other organization operators cannot see.

### Field validation still required
The implementation is not a substitute for a real church stress test. Pilot validation must exercise poor connectivity, multiple concurrent ushers, large people counts, reconnects, late synchronization, and real handset performance. Handwriting accuracy claims require a measured Nigerian benchmark rather than an assumption.
## Documentary record
**Last updated:** 23 September 2026

This edition supersedes stale assumptions in earlier versions, especially around hosting, People-card presentation, attendance-derived Last attended, current scan hardening, current ARIA action safety, daily briefing behavior, CI build configuration, Review Center consolidation, attendance parser/cache hardening, and the current production deployment state.

**Current canonical product name in this repository:** NYEOCARE.



---

# 25. SEPTEMBER 20, 2026 — PRODUCTION HARDENING INCIDENT & EXACT FIXES

This incident is part of the permanent engineering record because it exposed a class of failure where source code can be correct while production is still serving an older broken deployment.

## 25.1 Incident

The application was functionally very close, but production still reported historical failures from older Vercel deployments. The important runtime groups observed during the investigation were:

- `/api/review/resolve`: PostgreSQL could not determine the data type of parameter `$8`.
- `/api/people`: `ReferenceError: type is not defined`.
- `/api/attendance/process-session` and `/api/attendance/close-session`: `function pg_catalog.extract(unknown, unknown) is not unique`.
- One attendance request also showed a database connection timeout.

The engineering lesson is permanent:

> **A source fix is not a production fix until the production alias serves the fixed commit and the live runtime is verified clean.**

## 25.2 Root causes and exact fixes

### A. Review Center had duplicate implementations

**Root cause**

Home mounted the shared `ReviewCenterTab`, while `pages/people.js` also contained an inline Review Center implementation. The same capability therefore had two UI/control paths.

**Exact fix**

- Removed the inline Review Center implementation from `pages/people.js`.
- Reused the shared `ReviewCenterTab`.
- Routed legacy `/review-center` and `/reviewer-center` entry points to `/people?review=1`.
- Removed the dangling legacy block containing a bare `await fetch('/api/review/resolve', ...)` outside a function.
- Added `scripts/review-surface-regression.js`.
- Added the `test:review-surface` package script and CI guard.

The rule is now: **one Review Center surface, one resolver path, one source of truth.**

### B. Review resolution failed on an untyped JSONB parameter

**Root cause**

The review-resolution SQL used a PostgreSQL parameter whose type could not be inferred, producing:

`could not determine data type of parameter $8`

**Exact fix**

- Added explicit PostgreSQL JSONB casts, including `$8::jsonb` in the affected update path.
- Applied the same explicit typing discipline to other review JSON parameters where needed, such as `$3::jsonb`.
- Preserved organization scoping and admin/owner authorization.
- Regression-tested corrected-person and review-resolution persistence against the real development database with rollback.

### C. People update referenced an undefined `type`

**Root cause**

The People update route built a SQL placeholder from a variable that was not defined on the execution path, producing:

`ReferenceError: type is not defined`

**Exact fix**

- Rebuilt the placeholder construction deterministically from the validated person-type value in the update flow.
- Added a deterministic regression guard in `scripts/critical-ui-regression.js`.
- Re-verified the persistence path against the actual schema.

### D. Attendance absence SQL passed an untyped timestamp into `EXTRACT`

**Root cause**

The absence-generation query used PostgreSQL `EXTRACT` with an untyped parameter. PostgreSQL therefore resolved it as:

`EXTRACT(unknown, unknown)`

and could not select a unique overload.

**Exact fix**

The authoritative query in `lib/aria/participationGenerator.js` now uses:

`EXTRACT(ISODOW FROM $4::timestamptz)::int`

A regression assertion was added to `scripts/critical-ui-regression.js` requiring that explicit timestamp cast to remain present.

### E. AttendanceModal had several parser-sensitive structural defects

**Root cause**

`components/AttendanceModal.js` contained malformed/compressed declarations that produced misleading SWC syntax failures:

- malformed `catch` syntax;
- malformed `processingStatus` status-icon declaration;
- compressed asynchronous declarations;
- combined response parsing that obscured the actual failure point.

**Exact fix**

- Repaired the malformed `catch` structure.
- Repaired the status-icon declaration.
- Rebuilt AttendanceModal control flow cleanly rather than continuing to patch isolated syntax failures.
- Split the attendance people-response parsing into separate steps.
- Removed the remaining compressed declarations that were triggering SWC parsing failures.
- Restored attendance cache coherence after marks by updating the cached people state.
- Added/updated regression checks so cache coherence is tested independently of local variable naming.

### F. Review API summary route contained malformed template syntax

**Root cause**

`pages/api/review/index.js` contained malformed escaped template-literal syntax.

**Exact fix**

Repaired the summary-string/template syntax so the route compiles normally and returns the intended review summary.

### G. CI needed safe build-time environment values

**Root cause**

The standalone GitHub web build reached Next.js page-data collection without the public Supabase variables required by the application at build time.

**Exact fix**

Added CI-only placeholders for `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `DATABASE_URL` in `.github/workflows/web-build.yml`. These do not replace production secrets.

### H. Vercel deployment rate limiting temporarily blocked delivery

**Root cause**

During the debugging cycle, Vercel Git integration reported a deployment-rate-limit failure, so several source commits could not immediately become production deployments. This created a dangerous gap between repository state and live production state.

**Exact fix / operating rule**

- Continued fixing and validating the actual repository rather than interpreting the old production error dashboard as proof that the latest source was broken.
- Allowed Git integration to resume and verified the first successful production deployment after the rate-limit block cleared.
- Never treat an unpromoted Git commit as the production release.
- Always verify the production alias after deployment.

### I. Production deployment and live runtime were verified

The repaired production deployment was:

- Deployment: `dpl_DP3QkfawTSQ1tX46nWG4RYPPaKmG`
- Commit: `953f6878c06b8cdebebe362f02d6a055bf3164c5`
- State: `READY`
- Target: `production`
- Primary alias: `nyeocare.vercel.app`

Live verification:

- `https://nyeocare.vercel.app/` returned **HTTP 200**.
- The production alias was confirmed to point to the new READY deployment.
- A runtime-error check over the most recent 10-minute window returned **no runtime errors**.
- Historical runtime-error groups must be interpreted in deployment context; they belong to older deployments and are not, by themselves, evidence that the current deployment is failing.

## 25.3 Regression rules added from this incident

Future critical-path work must preserve these guards:

- One Review Center surface only; no duplicate inline resolver.
- Review JSON SQL parameters are explicitly typed where PostgreSQL cannot infer them safely.
- Person type placeholders are constructed from validated values, never undefined identifiers.
- Attendance `EXTRACT` timestamp parameters are explicitly cast to `timestamptz`.
- Attendance cache state remains coherent after mark/undo mutations.
- AttendanceModal async control flow remains explicit and parser-safe.
- CI uses safe build-time placeholders without weakening production secrets.
- A production fix is not verified until the current production alias serves the intended commit and live runtime checks are clean.

## 25.4 Engineering rule created by this incident

For NYEOCARE critical surfaces, the release chain is now explicitly:

**Source correctness → regression guard → successful build → production deployment → alias verification → live smoke/runtime verification.**

A commit being present on `main`, a build being green, or a historical error disappearing from source code is not enough by itself.

NYEOCARE should never call a root cause “fixed” merely because the source file looks correct.

## 25.5 SEPTEMBER 20, 2026 — ATTENDANCE ARIA EVENT ENQUEUE FAILURE

A fresh clean-state attendance test exposed one additional production failure after the earlier hardening work. This was traced to the exact ARIA event-enqueue SQL stage, not to attendance marking, session closing, or the ARIA processing lock itself.

### Observed production failure

The saved session named `Test` entered the intended recoverable state:

- attendance session: `closed`
- `aria_processing_status`: `failed`
- attempts: `1`
- stored error: `ARIA processing incomplete: events:could not determine data type of parameter $3`

Vercel runtime telemetry identified the same root error in `/api/attendance/close-session` on deployment `dpl_F2j6uA77d9xXPr5DmnZNNgDvZGpp`.

### Root cause

In `lib/aria/participationGenerator.js`, the ARIA event enqueue query passed `sessionId` as PostgreSQL parameter `$3` inside `jsonb_build_object(...)`. Because the SQL expression did not otherwise give `$3` a concrete type, PostgreSQL could not infer its type and rejected the statement before durable ARIA event processing began.

This is the same broader class of PostgreSQL failure already seen elsewhere in NYEOCARE: application-level values must be explicitly typed at SQL boundaries when PostgreSQL cannot infer a parameter type safely.

### Exact fix

The authoritative query now uses:

`jsonb_build_object('session_id',$3::uuid,'participation_id',p.participation_id)`

The session identifier is therefore explicitly treated as a UUID at the JSON construction boundary.

A regression guard was added to `scripts/critical-ui-regression.js` so the explicit `$3::uuid` cast is required by the critical-path test suite.

### Verification

The fix was verified against the production database with a rollback-only execution of the same event-enqueue shape using the failed `Test` session's real participation records. The insert executed successfully and returned the expected participation/person rows; the transaction was rolled back, so the verification made no persistent data changes.

The fixed commit was:

`919d12abb77b74575c6ec4b78e8bde63da25cf05`

The regression-guard commit was:

`fd5296944de8e8b1e306a98b19b31fdfb94b5593`

Production deployment for the guarded commit:

`dpl_8GnCmR8x8WEFedjEJPQrSJx4B5UV`

Deployment state: `READY`, target `production`, with `nyeocare.vercel.app` assigned.

Live smoke verification returned HTTP 200 from `https://nyeocare.vercel.app/` after the deployment.

The only matching runtime-error group observed after deployment was the earlier 08:44:54 UTC failure from the old deployment; no new instance of the `$3` type-inference error was observed on the patched deployment during verification.

### Recovery behavior

The failed `Test` attendance session is intentionally preserved as a closed, retryable session. No attendance marks were deleted or rewritten to hide the failure. The correct recovery path is **Retry processing**, which reclaims the saved session through `/api/attendance/process-session` and runs the corrected ARIA pipeline.

The system must not silently mark the session completed after an internal ARIA failure. Completion remains a durable state assertion that the participation/event/observation/action pipeline actually finished.

### Permanent rule

For every PostgreSQL query in the ARIA attendance pipeline:

**If a parameter's type cannot be inferred from surrounding SQL, cast it explicitly at the SQL boundary.**

For every attendance-processing fix, verification must cover all of:

**saved attendance → participation persistence → ARIA event enqueue → event processing → absence reasoning → action planning → completed session state**.

The UI's retry state is part of this contract: a failed ARIA pass preserves the saved attendance and exposes a safe retry rather than fabricating completion.

## Attendance → ARIA → Daily Briefing contract

Attendance processing is the authoritative producer of attendance-derived ARIA memory. A completed session must durably create its participation records, absence observations, and immediate human-review actions before processing is marked completed. Retries are idempotent through durable action keys.

Daily Briefing is a read/presentation layer. It MUST NOT discover or insert attendance actions as a side effect. This prevents two independent decision paths from drifting apart.

Immediate first-session absence is an observation, not a pattern claim. The corresponding follow-up is intentionally lightweight, requires human approval, and carries the source session in action metadata so later context and return events can connect to it.

Human context supplied through Tell ARIA becomes durable attendance context. It can change future reasoning but is never treated as proof. A later recorded return resolves the relevant absence/context and can create a return observation and welcome-back action.

## Attendance state contract

Attendance has two different states that must never be conflated in the UI or API:

- `active` / **LIVE** means a session is currently open and attendance can still be recorded.
- `closed` with ARIA processing pending/processing/failed means attendance has already been saved; it is recoverable for processing, but it is **not LIVE**.

The homepage LIVE cue must be derived from both the API's live flag and `status === 'active'`. A saved session may surface a separate ARIA processing notice while processing continues. Completion must remove that notice without reviving the LIVE cue.

Regression test: save/close attendance while ARIA is still processing, return to Home immediately, verify the control does not say `Attendance · LIVE`; verify any processing notice clears after the session reaches `completed`. Also verify the discard → immediate new session path remains race-safe.


## ARIA Director contract

ARIA is the canonical operating director of NYEOCARE. Scan, Review Center, People, Attendance, Care, and ARIA Today are capability surfaces; they are not independent intelligence systems.

The canonical loop is:

**Perception → Understanding → Memory → Reasoning → Permission → Action → Observation → Learning**

Every meaningful system event should enter ARIA's durable event/observation/action pipeline. UI surfaces read and present that shared state.

- **Scan:** ARIA reads the register, resolves identity, creates people only when safe, and creates durable review work when human confirmation is required.
- **Review Center:** human corrections are evidence for ARIA learning and identity memory; Review Center does not make independent intelligence decisions.
- **People:** the canonical person record is memory; ARIA state/intelligence explains what is known and what needs attention.
- **Attendance:** attendance is evidence. ARIA converts it into participation, observations, context-aware reasoning, and human-approved next actions.
- **ARIA Today:** is the director's read model. It must not invent or persist attendance/care decisions as a side effect.
- **ARIA conversation:** is the natural control surface over the same capabilities and memory, not a separate brain.
- **Human permission:** external or consequential actions remain proposed/approved rather than silently executed.

A module may own its domain transaction, validation, or presentation. It must not create a competing intelligence pipeline for the same evidence.



## Production reliability hardening — September 27, 2026

### Client error recovery
The application-wide ClientErrorBoundary must reset when Next.js route state changes. A single client rendering exception must never permanently blank unrelated screens until a manual hard reload. The ARIA launcher is additionally isolated in its own boundary so launcher failures cannot take down the underlying application.

### Attendance session truth
When online, server session state is authoritative. Local Field Mode/attendance cache may be used as an offline recovery source, but a cached session must never be rendered as live before the server confirms that an active session exists. A closed session must therefore disappear from the live attendance surface even if stale local data survives.

### ARIA care-draft reliability
Care-draft construction must initialize all derived contact values before any database INSERT uses them. Draft generation is human-review/human-send only; failure to build the draft must surface a recoverable error and must not partially create an outbound communication record.

### Environment safety
Weather/environment enhancement code is non-critical UI enrichment. Its state must be explicitly initialized and every background update must fail closed without producing an application-wide client failure.

## Review Center detail continuity — September 27, 2026

Opening a scan identity review is a nested Review Center state, not a new destination. The detail sheet must preserve the current Review Center group. The sheet back control, backdrop dismissal, and device/browser back all return to that same review list instead of closing the parent Review Center surface. Resolving an item also returns to the queue so an operator can continue through the remaining work; only the explicit Review Center close action returns to the parent surface.

Pending scan-review evidence remains truthful historical evidence. New scan-pipeline releases must not silently rewrite an unresolved row or auto-merge a person merely because a current candidate is now verified. Current candidate records are hydrated from live People data, while the original extraction and uncertainty remain auditable until an authorized human decision resolves the review.

## 25.6 SEPTEMBER 22, 2026 — ARIA CONVERSATION RESPONSE TRUNCATION

A production ARIA conversation answered the request **“What should I do next?”** but the assistant message ended mid-sentence at **“He”**.

### Observed production failure

The failure was not a visual rendering cutoff. The complete persisted assistant row ended at the same point, and the AI usage event recorded:

- model: `groq-qwen3.8-27b`
- purpose: `aria_conversation_response`
- output tokens: `360`
- finish reason: `length`
- HTTP status: `200`
- success: `true`

The system therefore treated a model output-limit termination as a successful complete response and persisted it.

### Root cause

`naturalResponse()` in `lib/aria/conversationEngine.js` requested exactly `maxTokens:360`. The AI gateway logged the provider finish reason but did not return it to the caller, so the conversation engine could not distinguish a complete `stop` from an output-limit `length`.

### Exact fix

- `lib/aiGateway.js` now returns the provider `finishReason` alongside response text and usage.
- ARIA narrative generation now requests up to `1000` completion tokens while instructing the model to remain focused and complete.
- When the provider returns `finishReason === 'length'`, ARIA automatically requests a continuation using the already generated answer as assistant context.
- Continuation is bounded to two additional passes so a pathological response cannot loop indefinitely.
- The continuation request uses a separate purpose `aria_conversation_response_continuation` so its usage and budget are observable independently.
- Final response storage is delayed until the completion-safe assembly finishes.
- The final response is bounded to `12000` characters, independent of the provider token limit.

### Permanent contract

**A model response with finish reason `length` is incomplete, never complete.**

The canonical conversation pipeline is:

**Generate → inspect finish reason → continue when length-truncated → assemble → persist → render.**

The UI must never be responsible for guessing whether a response was truncated. Completion status belongs to the server-side AI gateway/conversation layer.

### Regression guard

`scripts/critical-ui-regression.js` now requires:

- AI gateway finish-reason propagation.
- A larger narrative completion budget.
- Explicit length detection.
- Bounded continuation.
- The dedicated continuation purpose.

This incident joins the permanent production rule that source correctness, deployment correctness, and runtime correctness must all be verified before a critical ARIA fix is considered complete.


### 25.6.2 ARIA adaptive conversation verbosity

ARIA conversation length is a cognitive behavior, not a fixed formatting rule.

**Default behavior**
- Be concise when a short answer resolves the request.
- Lead with the useful answer and stop when the thought is complete.
- Prefer progressive disclosure over dumping all available evidence.
- Do not repeat facts already established in the current conversation unless necessary for clarity.
- Prefer a few high-value signals over exhaustive lists.

**Response modes**
- `concise`: normal conversation, simple facts, follow-ups and short requests. Target a compact answer.
- `decision`: “what should I do next?”, “what matters most?”, attention and change questions. Give focused priorities and reasons without dumping every record.
- `standard`: genuinely multi-part or evidence-heavy questions. Cover the necessary evidence and implications.
- `deep`: explicit requests for detailed, thorough, step-by-step, comparative, teaching or reasoning-heavy explanations.

Explicit user requests for brevity override the adaptive defaults. Explicit requests for depth override concise/default behavior.

The amount of available organization data alone MUST NOT force a long response. Complexity should increase context coverage only when it improves the answer.

### 25.6.1 Completion-exhaustion hardening

The completion-safe pipeline must also fail safely when all bounded continuation attempts are exhausted.

- A response remains incomplete while the provider finish reason is `length`.
- After the bounded continuation budget is exhausted, ARIA must not persist the assembled partial response.
- When a complete deterministic summary exists, that summary may be returned as the safe fallback.
- Otherwise the API returns a retryable `503` so the UI can show a recoverable error rather than presenting incomplete intelligence as complete.
- Deterministic responses do not make a second narrative-generation call.

### 25.6.1 Release status

The completion-safety implementation is merged into `main` at commit `c22a624aca2bfec304d326ff48ce0cccf2aeec46`. Production release verification remains part of the release contract: the deployed production alias must serve this commit before the incident is considered closed.

## 25.6.3 ARIA confirmed-action behavior

ARIA conversation may move from understanding to a consequential action, but **intent is not permission**.

The canonical interaction is:

**Understand → propose → ask for confirmation → prepare/approve → human reviews → external human action → observe outcome**

### Confirmation contract

- ARIA MUST ask before it drafts a new consequential message or prepares another state-changing action from a conversation request.
- The first response creates only a durable aria_actions proposal. It MUST NOT generate the message body or execute an external action.
- The proposal stores the conversation identifier, request context, action type, confirmation requirement and, for messages, the requested draft style.
- Confirmation may be explicit UI input or a short natural-language confirmation such as **yes**, **go ahead**, **prepare it**, or **not now**.
- A confirmation is valid only against the most recent unexpired proposal for that conversation and organization.
- Conversation confirmation is restricted to an active organization owner/admin, consistent with the action API authorization boundary.
- Declining a proposal cancels it and produces no draft.
- Confirming SEND_MESSAGE approves the action and may then create a WhatsApp draft. The draft is never sent by ARIA.
- Confirmed WhatsApp drafts expose a wa.me link so the human opens the native WhatsApp composer, verifies/edits the text, and presses **Send** themselves.
- ARIA MUST distinguish **proposed**, **approved**, **drafted**, **externally sent**, and **observed outcome**. Opening WhatsApp is not proof that a message was sent.
- If a local Nigerian phone number is stored with an 0 prefix, WhatsApp links normalize it to the 234 country-code form. International 234... and +234... forms remain supported.
- Adaptive verbosity still applies: confirmation prompts are intentionally short and context-specific; ARIA does not explain the entire reasoning chain before asking for a simple permission decision unless the user explicitly requests depth.
- The system MUST NOT introduce a second action/approval pipeline outside aria_actions.

### Failure safety

A confirmation flow that cannot prove the proposal still exists, is unexpired, belongs to the current conversation/organization, and is available to the current authorized user MUST stop without preparing or executing anything.

### Release verification

The confirmed-action release is not complete until CI passes the canonical regression suite, the production build succeeds, the deployed alias serves the intended commit, and a live smoke test verifies the ARIA action-confirmation surface.


## Canonical interaction and ARIA review behavior
- **Last seen / last attendance:** People and Person Journey use the same canonical attendance signal: engagement_metrics.last_seen when available, otherwise the latest confirmed attendance participation, otherwise the latest confirmed attendance record mark. Person Journey displays this as month + day.
- **Last interaction:** an interaction is an inbound communication, an outbound communication with a sent/delivered/read/completed state, human-recorded care feedback other than no_response, or a human/conversation timeline event that is not an internal administrative/ARIA event. ARIA drafts are never counted as contact.
- **Daily ARIA behavior:** daily action suggestions use the same last-interaction definition as Person Journey, so creating an ARIA draft cannot reset the contact clock.
- **Attendance review:** unresolved attendance-absence actions can appear in Review Center after a session is closed. A human can tell ARIA that the person attended or did not attend. The existing transactional attendance correction updates the attendance record, resolves/cancels the stale ARIA action, recalculates intelligence, and drafts a follow-up only when absence is confirmed.
- **WhatsApp handoff:** ARIA does not auto-send care drafts. It uses WhatsApp Click to Chat with the message pre-filled in the person's chat so the operator can edit it before choosing to send.
- **Message size:** care drafts target a message body below 180 characters, with the final attributed draft capped at 300 characters.

## Deployment and release discipline — canonical 2026 architecture

NYEOCARE uses **GitHub Actions as the controlled production build/release pipeline**. Vercel is the runtime and deployment destination, not the place where every Git push must trigger a new build.

### One batch → one production deployment
- Development may contain many edits and intermediate commits.
- Do not push every small implementation change directly to main.
- Group related work, test it, then land the completed batch as **one intentional main commit**, normally by squash-merging a PR.
- A main commit is the production release unit. One accepted batch should produce one production deployment.
- Never create extra “just to trigger Vercel” commits. If deployment fails, fix the cause and redeploy the same validated commit or use the preserved build artifact.

### Build once, deploy the artifact
Canonical production path:

feature work → PR/review/regression tests → ONE intentional main commit → GitHub Actions → vercel pull (production) → vercel build --prod → verify .vercel/output → preserve build artifact → vercel deploy --prebuilt --prod --archive=tgz → production smoke test.

vercel build creates the Vercel Build Output in .vercel/output. The deployment step must use vercel deploy --prebuilt so Vercel does not rebuild the source during deployment. The --archive=tgz option is preferred for production uploads when the output contains many files because it reduces file-upload overhead.

The validated .vercel/output is also retained as a GitHub Actions artifact for the release run. This is a release artifact, not a second application build. It exists so a successful build can be preserved, inspected, and redeployed without rebuilding the source.

### Vercel Git integration
Automatic Vercel Git deployments are disabled for NYEOCARE. Production delivery is owned by GitHub Actions so a Git push cannot unexpectedly consume Vercel build capacity or create duplicate production builds.

The repository vercel.json must keep git.deploymentEnabled=false. If this policy is ever changed, update this section and the CI workflow together. Do not create a second independent production deployment path.

### Deployment failure rule
A Vercel build-rate/build-capacity error is an infrastructure/deployment-path problem, not proof that application code is broken. First inspect the actual failing deployment and CI result. If Git integration attempted an unwanted build, confirm automatic Git deployment is disabled. Do not create repeated commits merely to retry.

### Verification rule
A release is not “live” merely because GitHub is green. It is complete only when the canonical regression suite passes, vercel build --prod succeeds, .vercel/output/config.json exists and is preserved, vercel deploy --prebuilt --prod succeeds, the production alias serves the intended main commit, and a live smoke test checks the changed surface.

### Daily deployment-budget rule
Treat production deployments as scarce release operations. Prefer one complete validated deployment over many partial deployments. Preview deployments are optional and should not be created for every experimental push unless they are needed for a specific verification task.


### People card last-seen rendering regression guard
The People API and People card must be audited as two separate layers:
1. `pages/api/people.js` projects canonical `last_seen` from `engagement_metrics.last_seen`, then confirmed participation/attendance history as deterministic fallbacks.
2. `pages/people.js` renders that field with an explicit semantic `ny-last-seen` row and shows **month + day only**, using the Africa/Lagos timezone.
3. `styles/people-sizing.css` must style `ny-last-seen` and `ny-phone-row` through semantic class names. It must never infer row meaning from an SVG icon's geometry or use a broad `:has(>svg ...)` selector that can accidentally hide the last-seen row.
4. A missing last-seen value is an honest `Last seen · —` state; it must not be silently removed from the card.
5. The critical UI regression suite must guard this contract so a future icon/layout refactor cannot make real attendance data disappear from the People surface again.

This distinction matters because real September 2026 database records already contain canonical last-seen timestamps for affected people; when the API data is present but the card row is absent, the failure is presentation CSS, not attendance persistence.

## ARIA organization intelligence and operator hierarchy

ARIA has a dedicated organization context layer. Organizational questions use the current organization as the hard data boundary; ARIA must never answer from another organization or expose internal IDs, invitation tokens, passwords or authentication secrets.

### Organization memory surface
The organization context may include the organization's name and age, People counts and composition, recent People additions, upcoming birthdays, open care/tasks, current attention items, recent attendance sessions, recent scans, organization memory, invitations and operator information. Large populations are summarized and selectively sampled instead of loading every record into one model prompt.

### Invitations are first-class organization events
ARIA distinguishes pending, accepted, expired and revoked invitations where the underlying record supports those states. An accepted invitation is connected to the resulting organization operator. A pending invitation may not have a person's name when the current invitation table did not persist one; ARIA must say that the name is not recorded rather than inventing it.

### Operator activity
An organization operator is not the same entity as a People record. ARIA can answer operator questions from operator records and recorded activity such as joining, invitations, attendance marking/reviewing, sessions, scans, People creation, care feedback, tasks created, and approved ARIA actions. ARIA must distinguish joining/being invited from operational work; a new operator with no activity must be described as having no recorded operational activity yet.

### Role-aware information hierarchy
- Owner: detailed information about organization operators, invitations and recorded operator activity, subject to normal privacy and safety rules.
- Admin: detailed information about user operators; only basic information about owners and other admins unless the admin is asking about their own record.
- User: detailed information about user operators; only basic information about owners/admins unless the user is asking about their own record.
- Every operator can access their own detailed operator record.
- This hierarchy controls read visibility in the data layer; it is not delegated to the language model.

### Smart unknown/failure behavior
ARIA must separate unknown, not recorded, not enough evidence, and temporary read failure. A database or type error such as a UUID/text mismatch is an implementation issue and must never be shown to an operator as the answer. The server logs the technical error for debugging while ARIA tells the operator plainly that it could not verify the requested information and will not guess.

### Safe schema boundaries
Database identifier types must never be compared implicitly across incompatible types. In particular, scan_jobs.actor_id is stored as text while users.id is a UUID; operator activity queries must normalize the comparison explicitly, for example with users.id::text, rather than relying on an implicit text/UUID comparison.

### Operator usefulness
ARIA should be able to answer practical questions such as: who joined recently; who was invited and what role were they given; has the new admin done anything yet; who last worked on attendance; who is currently handling these tasks; what changed in this organization recently; what information is not recorded; and what needs an owner's attention.

Read questions should be fast and direct. Consequential actions still use the existing approval gate; better organization context should make the preparation step easier without granting ARIA autonomous authority.

## ARIA conversation reliability: response synthesis must not crash the chat surface

ARIA conversation is a read-first operator surface. A failure while summarizing, formatting or synthesizing a verified result must never turn into a raw server error for the operator. Technical failures are logged for engineering; ARIA should return the best safe verified text already available, or a plain statement that the requested information could not be verified. Stale variables removed from organization-context refactors must be covered by regression tests.


# 26. SEPTEMBER 23, 2026 — ARIA INTELLIGENCE CORE V1

This release converts ARIA from a collection of useful care modules into one coherent intelligence architecture while preserving existing product surfaces.

## 26.1 Canonical intelligence loop

Perception → Evidence → Living Truth → Temporal Context → Attention → Recommendation → Human Decision → Action → Outcome → Learning

The LLM is a replaceable reasoning component inside this loop. It is never the source of truth, policy or authorization.

## 26.2 Evidence discipline

ARIA uses explicit epistemic states: verified, observed, reported, inferred, conflicted, unknown and stale.

Every surfaced evidence item carries provenance including source, source ID, time, authority and bounded confidence. Internal reasoning traces are not presented as evidence. Missing data is an explicit unknown, not a guessed fact.

## 26.3 Living Truth

people.living_truth is the persisted truth summary for a person. It is derived from organization records and human evidence rather than model guesses.

Overall states are alive, needs_decision and conflict. Confirmed participation is verified evidence. Human care feedback is reported evidence. ARIA observations are observations. Unresolved uncertainty is kept visible.

## 26.4 Temporal intelligence

Organization changes and person history now have dedicated read-only context functions. The organization timeline combines ARIA events, people, sessions, invitations and care activity. The person timeline combines participation, communications, care feedback, observations and actions.

These layers provide the time axis required for questions such as “what changed?”, “what happened?”, “what is different from before?” and “what do we know now?”.

## 26.5 Attention and decision ladder

ARIA may use current deterministic numeric signals internally, but operator-facing decisions are expressed as explicit steps:

DO_NOTHING → WATCH → ASK → RECOMMEND → PREPARE → REQUEST_APPROVAL → ACT → ESCALATE

External real-world actions remain behind server-side authorization and human approval. The model cannot grant itself permission.

## 26.6 Human control and prompt-injection resistance

Retrieved names, notes, messages, documents, scan text and timeline content are treated as data, never instructions. Retrieved content cannot change ARIA's policy, permissions or tool behavior.

Read operations can execute immediately. State-changing operations remain preparation/approval flows. This follows current agent-safety practice emphasizing structured data flow, tool approvals and trajectory-level monitoring. OpenAI reports that long-running systems can produce failures that are not visible when evaluating isolated actions, while Anthropic emphasizes multi-turn evaluation and maintaining meaningful human control over consequential agent actions.

## 26.7 Briefing boundary

The Daily Briefing read snapshot is read-only and must not run the mutable care cycle. An explicit authorized Generate Briefing operation may refresh intelligence and persist a briefing snapshot.

## 26.8 Regression rule

The ARIA test suite now has a dedicated intelligence-core regression guard covering provenance, Living Truth states, temporal context, attention policy, new capabilities, read/write separation, prompt-injection boundaries and transactional truth refresh.

Any future ARIA capability must plug into the canonical loop instead of creating a competing source of truth.

## 26.9 Peak ARIA target

Peak ARIA is not the model that says the most. It is the intelligence system that most reliably distinguishes what is known, observed, reported, inferred, conflicted and unknown; understands how those facts changed over time; recommends useful human next steps; respects authority; and learns from human outcomes without rewriting history.


## 26.10 Living Truth refresh policy and scale boundary

Living Truth is durable identity/human-context state, not a per-event cache. It must not be recomputed for every attendance, communication or ARIA event.

Authoritative identity/human-review paths may explicitly refresh and persist Living Truth. Routine events update the event, observation, intelligence and timeline layers instead. Read-time Living Truth assembly is lazy and organization-scoped.

This preserves the canonical loop without turning an N-person attendance session into an N-person, multi-query truth recomputation pass.

## 26.11 Intelligence-core release state

The September 23 intelligence-core work is being built on a feature branch and is not considered production until the full regression suite, application build, release artifact verification and final production smoke gate pass.

No intermediate Vercel deployment is part of this work. The production path remains:

**feature branch → review → final validation → one intentional main commit → one prebuilt Vercel production deployment → live verification.**



## 27. SEPTEMBER 25, 2026 — ORGANIZATIONAL INTELLIGENCE SPINE V1

The September 25 architecture work strengthens the existing ARIA foundation into one incremental intelligence spine. It does not introduce a second event bus, a second memory system, or an LLM-first brain.

### 27.1 Canonical event history and queue

`aria_events` is the canonical historical event stream and the incremental processing queue.

Events retain organization/person scope, source, provenance, confidence, verification state, temporal validity and an idempotent organization-scoped event key. Processing state is operational metadata only; historical evidence fields are protected from mutation/deletion.

The event processor claims small units, retries transient failures with bounded backoff, and records terminal failures without destroying historical evidence.

### 27.2 Canonical temporal memory

`person_memory` and `organization_memory` are temporal evidence stores rather than mutable dictionaries. A changed current claim supersedes the previous current row. Historical rows remain available with source event, verification, validity and actor information.

Relationships use the same current-versus-history model.

### 27.3 Incremental intelligence

Normal processing is:

EVENT → CLAIM → OBSERVATION / MEMORY / LEARNING → PERSON STATE → ACTION → OUTCOME → LEARNING.

The existing attendance processor remains responsible for deterministic attendance/participation persistence and large-register-safe absence detection. Those results enter the common ARIA event spine rather than creating a separate intelligence architecture.

The old organization-wide care cycle remains available as reconciliation/maintenance. It is no longer the normal event-processing path.

### 27.4 Provenance

ARIA keeps observation, human report, verified evidence and inference distinct. Absence/non-observation is stored as an observation and is never converted into an explanation merely because it is repeated.

### 27.5 LLM boundary

State transitions, authorization, persistence, deduplication, queueing, indexes, thresholds and provenance remain deterministic. Language models remain selective reasoning components for ambiguity and natural-language interpretation.

### 27.6 Current repository/database drift discovered during audit

The production database contains a September 25 organizational-intelligence foundation migration that is not present in the repository's historical migration directory. This is pre-existing migration drift and is explicitly recorded here instead of pretending the repository was already a complete database bootstrap. The September 25 event-spine migration added by this release is stored in the repository and applied to production.

Future database work must reconcile the complete migration history before claiming a fresh-environment bootstrap is equivalent to production.
---

## ARIA Organizational Intelligence Foundation v1

This implementation strengthens the existing ARIA intelligence core rather than creating parallel intelligence systems.

### Canonical intelligence spine

Operational reality enters through existing NYEOCARE mutations and observation surfaces. Where an event is appropriate, the canonical ARIA event spine records immutable historical evidence plus provenance, confidence, verification state, scope, expiry and processing state. The existing durable event worker processes those events incrementally; there is no second Sunday-sized intelligence queue.

The intended loop is:

OBSERVE → UNDERSTAND → DECIDE → HUMAN ACTS → OUTCOME RECORDED → ARIA LEARNS → BETTER FUTURE DECISION.

Deterministic work remains deterministic: persistence, state transitions, permissions, validation, relationship updates, event semantics, scheduling, deduplication and retrieval do not require an LLM.

### Organizational memory

Organization memory, person memory and relationship memory are versioned through current-row semantics. Replacing a current fact supersedes the prior row instead of erasing history. Memory may include source event, evidence type, confidence, verification, actor, temporal validity and optional expiry/reconfirmation.

ARIA must distinguish:
- fact;
- observation;
- human report;
- inference;
- uncertainty.

Inference must never silently become fact.

### Group and organization understanding

The organization model remains generic. Groups, memberships and roles provide structural context. Services/events now carry organization-defined semantics such as event kind, scope, expected population, attendance interpretation, optionality and whether absence has meaningful interpretation.

No church-specific weekday is hardcoded into the intelligence model.

A new organization can create useful history from its first service or event. History grows from real operations rather than requiring a manual historical reconstruction.

### Absence semantics

Non-observation is an observation. It is not an explanation.

ARIA may use accumulated evidence to decide that a human check-in is worth preparing, but the default care posture is person-first. A care recommendation must not automatically turn an attendance observation into an attendance-pressure message.

Event semantics determine whether non-observation is meaningful at all. Optional or non-participatory events must not be treated like ordinary expected participation.

### Communication outcomes and learning

Communication outcomes are structured evidence, not just message logs. Sent, delivered, opened, received, ignored, rejected, positive/negative response, help request, no-contact request and information update states enter the same ARIA event/learning system.

Human feedback is first-class learning. Explicit operator corrections can become provenance-aware memory with a scope and optional expiry. Organizational rules and conventions should be remembered and reused rather than rediscovered in repeated conversations.

### One ARIA, permission-scoped surfaces

Scan, attendance, people, care, relationships, event semantics, memory, learning and conversation use the same intelligence spine. Capabilities are interfaces into that shared mind, not separate ARIAs.

Shared intelligence never bypasses authorization. Organization boundaries, role boundaries, group/department boundaries, privacy and RLS remain mandatory. Durable memory writes that change organizational truth require an explicit authorized operation; ordinary retrieval or inference must not create facts.

### Performance and release discipline

Normal event flow is incremental. No organization-wide giant AI batch is required for a completed service.

Repository migration history must match the actual applied Supabase migration history. Production foundation migrations already applied are not blindly re-run; new schema changes receive new versioned migrations. In particular, the ARIA event processor's terminal `dead` state is represented by the applied `20260925200303_allow_dead_aria_event_status_v1` repair migration.




## 57. SEPTEMBER 25, 2026 — ARIA ORGANIZATIONAL INTELLIGENCE V2

Sections 27–56 of the product direction are now synchronized with the existing intelligence spine rather than creating another architecture.

### 57.1 Temporal intelligence
Person memory, organization memory and relationships already support `valid_from`, `valid_until`, supersession and current-state projections. Memory writes now preserve importance and can explicitly expire temporary knowledge. New organizational facts should use a validity window when the producer knows the fact is temporary.

### 57.2 Relationship-aware care
Care recommendations can now carry conservative relationship/contact candidates derived from current relationship evidence and successful historical outcomes. Candidates are evidence, not assignments. ARIA does not automatically choose or contact a worker merely because a relationship score is high.

### 57.3 Care objective
Attendance remains one evidence source rather than the care objective. Attendance absence reasoning is now opt-in through event semantics for new sessions. Group-scoped events restrict absence candidates to the relevant active membership population. Care recommendations remain human-approved.

### 57.4 Adaptive events and organizational norms
Sessions already carry event kind, scope, semantics, expected population rules, participation expectation, optionality and absence meaning. The new-session default no longer assumes that absence is meaningful. Organizational event semantics are stored as organization memory through the same canonical event/memory path.

### 57.5 Voice-ready architecture
The existing AI gateway already provides transcription and speech synthesis. These are interfaces into ARIA, not separate intelligence systems. Voice requests now use the same budget reservation/settlement path as text AI requests. No standalone voice intelligence platform was introduced.

### 57.6 Scan and identity preservation
Scanning remains population capture and identity resolution. Existing review, duplicate detection, merge history and learning paths were preserved. `identity_pair_decisions` remains a symmetric pair-decision model; no new ambiguous pair schema was added to ARIA learning.

### 57.7 Review Center and explainability
Important ARIA actions now persist a bounded evidence summary derived from the originating observation: evidence type, confidence, severity, urgency, facts, inference, sources and validity. This is an explanation surface, not internal chain-of-thought.

### 57.8 Authentication reliability
The browser session layer remains Supabase's persisted session source of truth. Client reads and refreshes are single-flight, transient read failures are not treated as proof of sign-out, and the session keeper remains passive. The previously documented authentication incident class—browser/server Supabase target mismatch and incorrect error classification—is retained as a regression concern.

### 57.9 Performance and attendance
Attendance persistence remains synchronous and bounded; downstream ARIA consequences remain background work. The canonical event worker processes small event units with automatic retry and idempotency. Ordinary UI actions do not wait for ARIA.

### 57.10 Budget and token discipline
The global budget lock is now organization-scoped rather than purpose-scoped, preventing concurrent purposes from bypassing the same daily/monthly aggregate reservation limit. Text, transcription and speech generation all use the same reservation/cancellation/settlement guard.

### 57.11 Chat and explainability
ARIA conversation remains a read-first organization intelligence surface. It retrieves current evidence, timelines, memory and outcomes through server-side organization boundaries. Consequential actions remain approval-gated. Action records now retain bounded evidence snapshots so operators can understand why a recommendation appeared.

### 57.12 Living Truth and conflict
Living Truth now surfaces recent `conflicted` memory claims in addition to identity conflict state. When two fresh human reports disagree about the same temporal memory key, the previous and new claims are retained as auditable conflict evidence instead of silently treating the newest statement as unquestioned truth.

### 57.13 Human correction and organizational learning
Operator context continues to enter the canonical event/memory path. Care outcomes now also re-enter the event stream through `CARE_OUTCOME_RECORDED`, allowing downstream intelligence processing to observe the outcome without making the outcome table a disconnected side system.

### 57.14 Privacy and browser data access
Internal ARIA memory, learning, actions, outcomes, budget reservations, AI usage and event history are now browser-read restricted to authorized administrative contexts through RLS. Conversations are limited to the owning operator or administrative roles. Server-side trusted paths remain responsible for internal intelligence writes.

### 57.15 Failure handling
Deterministic persistence remains independent from the LLM. Failed ARIA events remain recoverable through bounded retry/dead-letter state. AI reservation failures cancel the reservation; successful requests settle it; voice failures follow the same accounting boundary. A provider outage therefore does not invalidate already-persisted people, attendance or event evidence.

### 57.16 Testing rule
The ARIA V2 regression guard is now part of `test:aria`. It checks event semantics, temporal memory, explicit conflict handling, relationship-aware care evidence, action explainability, budget boundaries, voice accounting, authentication durability and RLS migration contracts.

The production release path remains:

**audit → feature branch → regression suite → application build → Vercel prebuilt artifact → one intentional production deployment → live verification.**

Future sections must continue plugging into the same canonical loop rather than introducing another memory store, event bus or intelligence brain.


## 58. SEPTEMBER 26, 2026 — FINAL ARIA ARCHITECTURE INTEGRATION

Sections 56–65 are now implemented against the repository and live production architecture. This section records the final integration state and the root-cause fixes that future work must preserve.

### 58.1 One intelligence architecture

NYEOCARE has one shared ARIA intelligence spine:

**OPERATING EVENT → EVIDENCE/CLAIM → MEMORY/OBSERVATION/LEARNING → PERSON/ORGANIZATION STATE → RECOMMENDATION → HUMAN ACTION → OUTCOME → LEARNING**

Attendance, scanning, People, care, relationships, event semantics, operator chat and future voice are interfaces into this spine. They are not separate intelligence brains.

Deterministic code and PostgreSQL remain authoritative for persistence, authorization, validation, identity decisions, thresholds, event semantics, queueing, idempotency, indexing and state transitions.

### 58.2 Failure handling

The LLM is never a prerequisite for core product persistence.

People can be saved without AI. Attendance can be persisted without AI. Canonical events can be recorded without AI. Deterministic intelligence can continue through AI outages. Background reasoning can resume later from the durable event/history boundary.

ARIA's event processor does not depend on the AI gateway for its basic event-processing contract. AI surfaces return safe fallbacks rather than converting provider failures into core-product failure.

### 58.3 Provider agnosticism

The AI gateway now resolves the provider adapter from the model registry instead of directly calling one vendor. `lib/aiProviders/` is the provider boundary; Groq is the current configured adapter, not the intelligence architecture.

Changing the active model/provider therefore remains a configuration/adapter concern rather than a rewrite of ARIA memory, events, care, relationships or permissions.

The active provider list may grow independently. A provider that is selected but not configured fails at the AI boundary without invalidating core NYEOCARE state.

### 58.4 Request idempotency and repeated AI calls

High-frequency text reasoning surfaces now accept stable idempotency keys:
- ARIA command planning uses the persisted user-message ID.
- ARIA narrative response synthesis uses the same user-message ID.
- continuation responses derive deterministic child keys.
- approved care drafting uses the action ID.

Completed responses are stored in `ai_request_cache` for bounded reuse. This prevents a retry after a completed request from automatically paying for the same completed text request again.

Scan duplicate processing remains protected primarily by the durable `scan_jobs` image hash/admission lock and bounded transient retry. The transient scan retry remains intentionally limited; it is not an unrestricted background retry loop.

### 58.5 Aggregate AI budget enforcement

The organization budget lock is organization-wide rather than purpose-specific, and daily/monthly accounting now aggregates all AI purposes for that organization. Purpose remains telemetry and policy context; it cannot bypass the aggregate budget.

Text, transcription and speech synthesis all use the same reserve → provider call → settle/cancel accounting boundary.

### 58.6 Scan/provider root-cause cleanup

The active scan path now flows through:

`scan start → vision processor → aiProvider compatibility facade → hybridScanProvider → provider registry → configured adapter`

The old direct-Groq `aiProviderCore` implementation has been reduced to a compatibility facade over the canonical hybrid provider path. This removes a second direct vision implementation that could otherwise drift from the active pipeline.

Scan admission/status/job metadata now report the actual configured provider/model rather than assuming Groq in control-flow metadata or user-facing error text.

Existing identity resolution, Review Center evidence, duplicate-review semantics and merge history were left intact.

### 58.7 Authentication and deployment

The current browser auth contract remains:

Supabase persisted session → serialized canonical session read/refresh → passive session keeper → server-side bearer verification → organization-scoped Care user.

No new auth layer was introduced in this integration.

The CI pipeline still builds and validates the same Vercel project using explicit project/team IDs. The previous production deployment was verified READY; the final integration deployment must be verified again after the final main commit.

### 58.8 Permissions and privacy

Internal ARIA memory, actions, outcomes, events, learning, budget and usage tables remain server-owned from the browser perspective under the strengthened RLS policy model.

Conversation access is owner/admin or conversation-owner scoped. Consequential ARIA actions remain server-side approval gated.

Privacy behavior is not delegated to the language model.

### 58.9 Performance principles

The performance boundary remains:
- persist user actions first;
- perform bounded reads;
- use indexes aligned with organization/person/time access patterns;
- process events incrementally;
- avoid organization-wide scans for local actions;
- keep background intelligence off the critical UI path;
- use deterministic work before expensive AI reasoning;
- bound returned collections.

Current repository regression tests protect these architecture boundaries. They are not a substitute for a future synthetic 10/50/100-concurrent benchmark or 10k-person production-like load campaign; those remain separate performance-validation work.

### 58.10 Organizational scale and extensibility

The core boundaries remain compatible with future 100,000+ people, multiple organizations and regions, arbitrary organization/event types, multiple languages, WhatsApp/SMS/email, provider/model changes, voice and analytics.

This is achieved by keeping organization/event semantics in data, using canonical event/memory abstractions, keeping communication as a replaceable channel boundary, and keeping AI behind provider adapters.

No hypothetical 100k-scale subsystem was added just to satisfy a number.

### 58.11 Root-cause fixes future developers must not undo

1. Do not recreate a feature-specific intelligence brain when a capability can consume the canonical ARIA spine.
2. Do not make absence synonymous with a reason or hardcode church weekdays into intelligence.
3. Do not hold attendance UI hostage to background intelligence.
4. Do not bypass aggregate organization AI budgets by changing the purpose label.
5. Do not call an AI vendor directly from business/intelligence modules; route through the provider boundary.
6. Do not create a second direct scan/vision provider implementation.
7. Do not persist model inference as truth without provenance and human/epistemic state.
8. Do not expose internal intelligence tables directly to ordinary browser users.
9. Do not turn retries into uncontrolled duplicate provider calls.
10. Do not treat transient auth read failures as proof that a user is signed out.
11. Do not replace explainability with chain-of-thought storage or exposure.
12. Do not reintroduce whole-organization reads into fast user interactions.
13. Do not redesign working UX before verifying the foundation.

### 58.12 Final definition of done

The final architecture is considered integrated when:
- one ARIA intelligence spine exists;
- memory is temporal and conflict-aware;
- event semantics are organization-defined;
- care is human-centered;
- relationships influence recommendations as evidence;
- operator feedback/outcomes feed learning;
- actions retain bounded evidence summaries;
- permissions remain explicit;
- core persistence survives AI failure;
- provider selection is abstracted;
- repeated text requests can be deduplicated by stable request identity;
- aggregate AI spend is enforced per organization;
- attendance/scan/background work remains non-blocking;
- regression suites pass;
- final production deployment is READY and matches the final main commit.

Future changes must extend this architecture rather than introduce a competing memory, event or AI layer.

## 59. FINAL IMPLEMENTATION NOTE

The architecture is intentionally quiet: organizations teach ARIA by living normally. NYEOCARE records useful reality; ARIA incrementally turns that reality into contextual intelligence. The system does not need a manually trained model or a giant historical import to start learning. Its memory is earned through real events, evidence, relationships, human corrections and outcomes.
## 60. CONVERSATIONAL ARIA + MULTI-PERSON DRAFTING

ARIA conversation now preserves structured referents across turns rather than relying only on raw message text. The latest assistant turn can retain referenced people, observations, actions and cohort membership so follow-up questions such as "What's the observation?", "Why?", "Tell me more", "Draft it", and "Draft it for 3 people" resolve against the immediately relevant evidence.

Attention responses expose linked observation/action identifiers and evidence. A specific observation can therefore be explained directly from the same evidence that caused ARIA to surface it.

ARIA now understands organization cohorts for bounded reasoning and drafting:
- past_absentees
- needs_follow_up
- current_attention
- new_people
- explicit selected person IDs

Quantity language is binding:
- "for 5 people" means no more than five people;
- "for all ..." means the resolved cohort is used up to the bounded system maximum;
- "only [person]" means one explicitly selected person;
- a named person takes precedence over a generic cohort.

Drafting is distinct from sending. A user can ask ARIA to draft one message or a bounded set of messages in the app without sending anything. Each draft is stored as an internal draft record and returned with evidence-safe context.

When the user explicitly requests WhatsApp drafting, the result carries WhatsApp handoff links. On supported devices those links open the recipient's WhatsApp conversation with the draft pre-filled in the compose field; the user can edit and send it. NYEOCARE never sends the message through this handoff and does not claim that WhatsApp contains an unsent multi-message "draft list", because the consumer deep-link interface does not provide that primitive. For multiple recipients, ARIA presents the complete draft queue in NYEOCARE and provides one WhatsApp handoff per recipient.

Daily ARIA Today / briefing can also request bounded follow-up draft batches. The same canonical drafting path is reused, so chat and briefing do not create separate message-generation logic.

## 60.1 Attention lifecycle hardening

When a later confirmed participation or return event supersedes an active unusual-absence observation, ARIA resolves the older absence signal and cancels still-unapproved attendance/return follow-up proposals for that person. Historical evidence remains in the timeline; only the active attention/action projection is reduced.

This prevents past signals from accumulating indefinitely as if they were still current.

## 60.2 Failure-safe conversational behavior

If ARIA cannot resolve a conversational referent, it asks for the missing scope instead of falling back to a generic organization summary. If the user asks for a specific observation, person or cohort that cannot be verified, ARIA says so and does not guess.

The goal is conversational continuity without sacrificing evidence, permissions or human control.


# 60. CANONICAL ARIA DIRECTOR — ORGANIZATIONAL INTELLIGENCE CORE v4

ARIA is not a chatbot layered on top of NYEOCARE. The canonical Director is the deterministic intelligence layer that reconciles the organization's current state before any language model is asked to speak.

### One ARIA, one interpretation

Organization-level surfaces must use the same Director state:
- ARIA Today / daily briefing.
- Talk to ARIA organization questions.
- Attention and care views.
- Future proactive ARIA surfaces.

They must not independently invent alternative definitions of "attention", "weakening", "growth", or "what matters".

### Director loop

```
EVENTS + PEOPLE + ATTENDANCE + MEMORY + RELATIONSHIPS + ACTIONS + OUTCOMES
                                ↓
                       EVIDENCE RECONCILIATION
                                ↓
                         ARIA DIRECTOR STATE
                                ↓
       WHAT MATTERS → WHY NOW → CONFLICTS → UNCERTAINTY → NEXT STEP
                                ↓
                     HUMAN DECISION / ACTION
                                ↓
                           OUTCOME
                                ↓
                           LEARNING
```

### Intelligence classes

ARIA separates:
- **Human care** — a person may benefit from relationship attention.
- **Organization opportunity** — something positive may be worth strengthening.
- **Operational risk** — the system or organizational process needs intervention.
- **Watch / uncertainty** — the evidence is not strong enough to justify intervention.

A raw observation is not automatically a problem.

### Temporal reconciliation

Attendance changes must be interpreted with:
- lifecycle state;
- amount of available personal history;
- participation volume;
- relationship state;
- recent confirmed participation;
- active observations;
- existing actions.

For example, an attendance decline signal on an onboarding relationship is classified as a watch rather than silently escalated as disengagement.

### Contradiction handling

When two intelligence paths disagree, ARIA must surface the disagreement and resolve it through evidence rather than silently selecting one path.

### Non-obvious insight

When evidence supports it, the Director should surface a useful organizational insight the operator did not explicitly ask for. Surprise must come from discovering real relationships between verified signals, never from invented facts.

### Human-memory coverage

ARIA tracks how much of the active population has human-supplied memory/context. Fast population growth with low human-memory coverage is an organizational intelligence condition: the organization may be growing faster than its relational memory.

### Operational signal lifecycle

Stale attendance-processing failures must not remain active forever. Successful later processing supersedes the failure observation/action, and old orphaned failure signals are cleaned from active attention.

### LLM boundary

The language model is not the canonical source of organizational state.

The model:
- explains Director state;
- adapts wording and depth;
- answers natural-language questions;
- drafts human-readable messages.

The model does not:
- define authoritative counts;
- decide whether an observation exists;
- silently resolve contradictory database facts;
- authorize external actions;
- invent organizational memory.

### Director explainability

The Director provides bounded evidence summaries and decision reasons. It does not store or expose hidden chain-of-thought. Operators see the conclusion, evidence category, uncertainty and next-step rationale.

### Current implementation

Canonical implementation:
- `lib/aria/directorEngine.js`
- `lib/aria/director.js`
- `lib/aria/capabilityEngine.js`
- `lib/aria/commandEngine.js`
- `lib/aria/conversationEngine.js`
- `pages/api/aria/daily.js`

Regression coverage:
- `scripts/aria-director-regression.js`
- `npm run test:aria-director`



# 60. ARIA CANONICAL DIRECTOR INTELLIGENCE — LOCKED ARCHITECTURE

ARIA is the organization’s synchronized intelligence, not a collection of independent assistant behaviors.

### Canonical cognition
All organization-level intelligence surfaces must converge on `lib/aria/directorEngine.js` and its `getDirectorBriefing()` result before narration or action planning:

```
EVENTS + PEOPLE + ATTENDANCE + MEMORY + RELATIONSHIPS + OBSERVATIONS + ACTIONS + OUTCOMES + HUMAN FEEDBACK
                                  ↓
                         ARIA DIRECTOR RECONCILIATION
                                  ↓
       WHAT CHANGED → WHAT MATTERS → WHY NOW → UNKNOWN/CONFLICT
                                  ↓
                  DECISION / OPPORTUNITY / WATCH / RISK
                                  ↓
                         HUMAN-REVIEWED ACTION
                                  ↓
                              OUTCOME
                                  ↓
                             LEARNING
```

The LLM is a replaceable language/reasoning interface used after deterministic reconciliation. It must not independently become the source of organizational truth.

### One ARIA, many surfaces
Home / ARIA Today, Talk to ARIA, People Journey, Care Queue, future notifications and future ARIA interfaces are different views of the same organizational mind. A surface may specialize presentation or ask a narrower capability, but it must not invent a competing interpretation of organizational state.

### Signal hierarchy
Not every stored observation deserves human attention. Background lifecycle observations such as confirmed participation, person updates and returned-after-absence history are memory/evidence unless another meaningful signal raises them into a decision-worthy state. The priority queue must only promote observations that can reasonably change a human decision, such as unusual absence, scan review, ARIA processing failure or other explicitly registered integrity/conflict signals.

### Director state
The canonical briefing contains:
- current organizational phase and population state;
- operational health separated from human-care signals;
- meaningful human-care focus;
- positive opportunities such as recognition, belonging and contribution;
- attendance patterns with lifecycle-aware reconciliation;
- contradictions between competing signals;
- non-obvious evidence-grounded insight;
- learning gaps and organization-specific memory coverage;
- explicit “what not to do” guardrails;
- a small human decision surface rather than an exhaustive queue.

### Intelligence rules
ARIA must never:
- treat every record as a problem;
- confuse a pattern with a diagnosis or motive;
- use silence/absence as an explanation;
- claim that generic care knowledge is an organization-specific rule;
- hide operational integrity issues because human-care signals are more pleasant to discuss;
- dump raw counts when interpretation is the useful part;
- silently choose between conflicting signals;
- claim consequential action was executed when it was only proposed or prepared.

ARIA should be able to say what she is deliberately **not** treating as a problem. This is a core intelligence behavior because restraint is part of correctness.

### Conversation continuity
When a director briefing is discussed in Talk to ARIA, conversation state persists its primary focus, insight, contradictions and relevant people/actions/observations so follow-up turns continue the same thought instead of restarting from generic organization context.

### Organization-specific learning
Organization memory, human corrections, care feedback and outcomes are evidence for learning what is unique about a particular organization. Empty organizational memory is itself a knowledge gap, not permission to invent norms. As human corrections and outcomes accumulate, director decisions may become more organization-specific while preserving current evidence and confidence.

### Signal-load protection
ARIA monitors the ratio of observations/actions to population. A high signal load is itself an organizational intelligence condition. When the system contains more recommendations or observations than a human should reasonably carry, ARIA should narrow the decision surface and protect trust before widening outreach.

### Regression requirement
`npm run test:aria-director` must remain part of the ARIA regression gate. The regression must verify that the canonical director capability, command routing, conversation-state persistence, Daily ARIA Today integration, signal filtering and ARIA director identity contract remain present.
## FIELD MODE — OFFLINE COLD-REOPEN CONTRACT

Field Mode is not considered production-ready merely because an already-open tab can continue marking attendance without connectivity.

After an authorized operator has created a real server attendance session and warmed the local roster, the device must also tolerate a browser/PWA close-and-reopen while offline. The Home application shell may be cached because it contains no organization-specific data; authenticated API responses and organization/person records must never be cached by the service worker.

On offline restart:
1. the persisted browser authentication session is read locally;
2. IndexedDB restores the current Field Mode session, roster and pending mutations;
3. Attendance opens directly from local state without depending on `/api/attendance/active-session`;
4. marking remains optimistic and coalesced locally;
5. reconnect automatically returns to the canonical server sync and session-finalization path.

### Discard semantics
Discard is an authoritative session-destruction action, not a local UI-only mutation. Only organization owners/admins may see or invoke it. The permission is returned by the active-session API and persisted with the Field Mode session so an authorized cached/offline reopen does not silently lose the action. When offline, NYEOCARE keeps the discard control safe by requiring reconnection before deleting the server session; it must never pretend a local-only discard has ended the shared organization session.

Any future change that removes this capability must be treated as a Field Mode regression.

---

## ARIA Internal Operator Messaging

ARIA can send a private in-app message from one authenticated organization operator to another authenticated active operator. This is distinct from WhatsApp and must remain inside the current organization.

### Truth and authorization

- The recipient is always an active row in `users`; ARIA must never resolve an internal message recipient from `people`.
- The sender is the authenticated operator. Owner, admin, and user operators may send to other active operators in the same organization.
- The explicit command must contain both a recipient and the exact message body. ARIA must not invent missing recipient text or message content.
- A message is persisted as a server-owned `aria_internal_messages` record. Browser clients do not receive direct table write access.
- Sending is idempotent for a single ARIA request so retries cannot create duplicate internal messages.

### ARIA Today synchronization

- Unseen internal messages are first-class ARIA Today queue items with task kind `internal_message`.
- Private internal messages are notification/inbox work, not part of the five-item care/action capacity. They remain pinned to the recipient and may appear alongside the recipient's compressed daily care queue.
- Assignment is pinned to the actual recipient; a message must never be redistributed to another administrator merely to satisfy the normal daily queue allocation.
- Opening a message records `seen_at` and completes its queue item transactionally.
- ARIA Today refreshes while open and on focus so message arrival/removal is reflected without requiring a hard reload.
- If a message is unsent before it is seen, the queue item is dismissed and the recipient does not receive an in-app message record on the next synchronized read.
- If a recipient has already seen the message, unsending changes the message to an unsent state rather than rewriting history to claim it was unseen.

### Unsend semantics

- Only the original sender may unsend their own message.
- `unsend it` can resolve the most recent internal message referenced by the current ARIA conversation state.
- `unsend my last message` resolves the sender's latest still-sent internal message, optionally narrowed to a named recipient.
- Unsend and read are serialized at the database row level so a simultaneous open/unsend cannot create a contradictory seen state.


## Production reliability hardening — September 27, 2026: scan quality and People recovery

- **Proven scan extraction architecture restored:** the production vision provider again reads tall registers as overlapping physical regions, merges observations using vertical position/name/phone evidence, and optionally performs an independent Gemini cross-check. This restores the multi-region behavior from the previously successful scan pipeline.
- **Physical-row accuracy remains primary:** Qwen is instructed to preserve literal name/phone characters, avoid autofill, keep continuation phones attached only when physical placement supports it, and flag ambiguity instead of guessing.
- **Current identity pipeline is preserved:** the restored extraction layer emits the current validator's evidence fields and continues into the existing identity resolution, Living Truth, review, duplicate protection and human-confirmation flow. A scan result never becomes attendance automatically.
- **Both camera and upload share the same client path:** supported JPEG/JPG/PNG/WebP files under the safe limit retain their original pixels; larger files use bounded high-quality preparation. This prevents PNG/WebP uploads from being needlessly degraded before vision.
- **People hydration/recovery is hardened:** browser storage is no longer read during the render phase; expired roster sessions can refresh automatically; stale Next.js chunk navigation performs a single automatic reload instead of leaving the user on the generic error screen.
- **Scope boundary:** these changes do not alter identity evidence rules, attendance truth, server-authoritative session semantics, or human confirmation requirements.

## Production reliability hardening — September 27, 2026: client exception containment

- **Client render failures are treated as engineering incidents:** the application must not rely on the friendly recovery screen as the diagnosis. Exact client exceptions must be traced and regression-tested.
- **Non-critical modules must not be part of the global failure domain:** scan recovery, environment enhancement, auth warming, ARIA background sync, and Field Mode runtime are loaded/isolateable independently so a failure in one cannot blank People/Home.
- **People optional browser APIs are feature-detected:** an unavailable IntersectionObserver or geolocation permission API must degrade quietly rather than throwing during a page effect.
- **People heavy review surfaces are lazy-loaded:** Review Center and Birthday Picker are not required to hydrate the People directory itself.
- **Stale Next.js/static-chunk recovery begins before React hydration:** a tiny document-level recovery listener watches for known module/chunk loading failures and performs one guarded cache-busting navigation. This complements, rather than replaces, the application-level route recovery.
- **Recovery is bounded:** a recovery key in sessionStorage prevents reload loops. A client exception that is not a known stale-chunk failure is never blindly reloaded repeatedly.
- **Deployment verification requirement:** a successful build is necessary but not sufficient. Verify fresh production HTML, the referenced client chunks, runtime error telemetry, and the People route after the deployment alias moves.

## Production reliability hardening — September 27, 2026: scan and app recovery

- **Client scan preparation is no longer needlessly fragile:** normal JPEG camera images within the server-safe size limit use a direct base64 path; larger/non-JPEG images use a bounded resize/encode path. Preparation/auth watchdogs use cancellable timers so successful operations do not leave timeout timers alive.
- **Scan timeout errors are user-safe:** internal timeout codes are translated into clear ARIA recovery messages; raw `TIMEOUT` is never the intended user-facing failure text. Session acquisition can refresh/retry before failing safely.
- **The client error boundary covers the full application tree:** route keys force a clean boundary instance when navigation changes, and the app's invisible revalidation signal can recover transient display failures without deleting server state.
- **Invisible revalidation is part of the runtime:** focus, pageshow, online, visibility and periodic checks warm the authenticated session and emit a background refresh event. Home and People revalidate quietly; background failures do not interrupt the operator.
- **Service-worker cache versioning is rotated with client recovery releases:** old static caches are retired when the new worker activates, preventing stale hashed bundles from remaining the canonical client after a production fix.
- **Scope boundary:** these changes do not alter identity evidence rules, attendance truth, server-authoritative session semantics, or human confirmation requirements.

## Production reliability hardening — September 27, 2026: navigation-specific client exception

A production client exception was reproduced with a path-dependent pattern:

- Profile → People: People loaded normally.
- Home → People: People could fail with the browser-level "Application error: a client-side exception has occurred" screen.
- Fresh/incognito opening of the normal production URL: the same generic client exception could appear.

This establishes an important reliability rule: a route can be healthy when entered from one already-mounted page while still failing when entered from another route or from a cold browser context. Therefore, "People works from Profile" is not sufficient evidence that the People route is production-safe.

### Diagnostic interpretation

The server route itself was not the primary failure signal. Production HTML for the homepage returned HTTP 200 and contained the current Next.js build assets and the early client-recovery script. The failure class is therefore treated as a client navigation / hydration / module-loading boundary, including failures that can occur before the React error boundary has a chance to render its friendly recovery UI.

The earlier generic NYEOCARE error boundary remains useful for post-mount React failures, but it must never be treated as proof that the underlying client exception is fixed.

### Permanent navigation reliability contract

1. Test cold and warm navigation separately: direct/cold load; Home → route; Profile → route; at least one other primary route → route; and a fresh/incognito browser context.
2. Do not validate a route through only one navigation path. Shared app shell, layout, global runtime modules, dynamic chunks, browser APIs, and hydration state can behave differently depending on what was already mounted.
3. Keep non-critical global modules isolated. A failure in environment enhancement, background sync, auth warming, scan recovery, or Field Mode runtime must not become a global route failure.
4. Keep heavy/optional route surfaces lazy. Review Center, Birthday Picker, Scan Modal and similar optional surfaces must not be required to initialize the base People directory.
5. Protect browser-only APIs. Feature-detect APIs such as IntersectionObserver and Permissions before invoking them.
6. Recover stale/missing chunks before hydration. The document-level recovery listener must remain available for chunk/module loading failures that occur before React mounts, with bounded recovery so it cannot loop.
7. Instrument post-hydration exceptions. Unhandled client errors must be sent to the diagnostics endpoint with pathname/surface information so navigation-specific failures can be distinguished from server failures.
8. Verify the actual production alias after deployment. A successful CI/build is necessary but insufficient; verify fresh HTML, referenced chunks, direct route loads, navigation paths, and runtime telemetry after the alias moves.
9. Never replace the root cause with a permanent manual Reload instruction. Recovery should be automatic where the failure is known to be transient/stale; unknown exceptions must be captured and fixed at their source.
10. Preserve server truth. Client recovery must not delete attendance, people, scan, ARIA, organization, or other server-owned data.

### Regression requirement

A future production reliability change is incomplete until the critical navigation matrix has been exercised and the result is recorded. At minimum: cold Home, Home → People, Profile → People, and incognito/cold production open. Any discrepancy between paths is treated as a first-class client reliability bug rather than a user-cache problem.

## Production reliability hardening — September 27, 2026: navigation-path client exception regression

A production client exception was reproduced with a specific navigation pattern:

- **Profile → People:** People loaded normally.
- **Home → People:** People could fail with the browser-level **“Application error: a client-side exception has occurred while loading nyeocare.vercel.app”** screen.
- **Fresh/incognito open of the normal production URL:** the same client exception could appear.
- This demonstrated that the failure could not safely be classified as a People-page data/API failure or as a generic stale-chunk problem.

### Diagnostic lesson

A route working after one navigation path does **not** prove that its client dependency graph is healthy.

The production investigation must compare:
1. direct cold load;
2. authenticated navigation from Home → People;
3. authenticated navigation from Profile → People;
4. the exact client chunks loaded by each path;
5. shared _app / Layout / runtime modules;
6. browser-side exceptions before and after hydration;
7. Vercel runtime telemetry.

For this incident, production HTML for Home was healthy and the server-side route itself was reachable. The useful signal came from reproducing the navigation difference and treating the browser exception as a client dependency/runtime problem rather than assuming the People API was broken.

### Permanent engineering rule

**Navigation history is part of the reproduction state.**

Every critical route regression test must include both:
- **cold entry** into the route; and
- **warm client-side navigation** into the route from each major shell surface that can reach it.

At minimum for the primary shell:
- Home → People;
- Profile → People;
- direct /people cold open;
- authenticated fresh-session /people;
- stale-cache/chunk recovery path where applicable.

A route that only works after another page has warmed the browser is not considered production-correct.

### Recovery architecture requirement

The friendly NYEOCARE error boundary is a containment layer, not proof that the application is healthy. Client exceptions must be diagnosed at the earliest layer possible:

    COLD HTML / STATIC CHUNKS
            ↓
    PRE-HYDRATION RUNTIME
            ↓
    NEXT APP SHELL / SHARED RUNTIME
            ↓
    PAGE MODULE
            ↓
    CLIENT-SIDE NAVIGATION
            ↓
    PAGE EFFECTS / BROWSER APIs
            ↓
    DATA / AUTH REQUESTS

When a route fails only after a particular navigation path, inspect shared modules and navigation lifecycle before changing the route's data layer.

### Regression protection

Future reliability changes must preserve:
- bounded pre-React stale-chunk recovery;
- route-keyed application error-boundary reset;
- isolated non-critical global runtimes;
- lazy loading of heavy/optional surfaces;
- feature detection for browser APIs;
- automatic auth/session recovery where safe;
- client exception telemetry to /api/diagnostics/client-error;
- production verification of cold load **and** navigation paths.

A browser-level **“Application error”** is an engineering incident even when Vercel reports no server runtime error. Absence of server logs must never be used to conclude that the client is healthy.

### Verification standard

After any change affecting _app.js, Layout, navigation, shared providers, global runtime modules, service-worker caching, or page-level dynamic imports, verify the following against the production deployment:

    DIRECT /people COLD LOAD
            +
    HOME → PEOPLE
            +
    PROFILE → PEOPLE
            +
    FRESH / INCOGNITO ENTRY
            ↓
    NO CLIENT EXCEPTION
            ↓
    NO UNEXPECTED SERVER ERROR
            ↓
    EXPECTED PEOPLE CONTENT

This incident is now a permanent regression case and must be used when reviewing future NYEOCARE navigation, caching, hydration, and client-runtime changes.

## Production reliability hardening — September 27, 2026: navigation regression resolved

The navigation-path client exception described above has now been resolved and the production app was rechecked successfully.

### Confirmed behavior after the fix

- **Home → People:** loads normally.
- **Profile → People:** loads normally.
- **Direct production entry:** loads normally.
- **Fresh/incognito production entry:** loads normally.
- The previous browser-level **“Application error: a client-side exception has occurred”** is no longer reproduced in the verified flow.

### Permanent lesson

A production route must be considered healthy only after both **cold-entry** and **warm-navigation** paths have been exercised. A successful page render from one route must never be used as evidence that another navigation path is safe.

When this class of failure returns, do not immediately patch the People page or its API. First compare:

```
DIRECT /people
HOME → PEOPLE
PROFILE → PEOPLE
FRESH / INCOGNITO → PEOPLE
```

Then inspect, in order:

```
browser console / client exception
        ↓
pre-hydration errors
        ↓
shared _app / Layout / providers
        ↓
dynamic chunks and page modules
        ↓
navigation lifecycle
        ↓
browser-only APIs / effects
        ↓
People data/API layer
```

This order prevents a client-shell/navigation failure from being incorrectly “fixed” by changing server data behavior.

### Future regression gate

Any change touching `pages/_app.js`, `Layout`, shared providers, navigation, dynamic imports, service-worker caching, authentication/session warming, global runtime components, or People page loading must re-run the navigation matrix before being considered production-safe:

- cold Home;
- Home → People;
- Profile → People;
- direct /people;
- fresh/incognito production entry;
- runtime/client telemetry review.

The goal is not merely that the route eventually renders. The goal is that **navigation history does not change whether a critical route works**.



## Production reliability hardening — September 27, 2026: Review Center bulk dismissal contract

A Review Center bulk-dismissal regression was identified and fixed.

### Failure
The Review Center represents scan-review queue IDs in the UI as `scan:<uuid>` so scan-review items remain distinguishable from other review groups. The bulk action sends those selected IDs to `/api/review/resolve`.

The API previously accepted only bare UUIDs for the bulk `ids` array. Because `scan:<uuid>` failed that UUID validation, the API treated the request as if no valid bulk IDs had been supplied and then fell through to the single-review action validator, producing:

> `Invalid review action.`

This was a contract mismatch between the Review Center's display/selection identifier and the API's accepted identifier format. It was not a database corruption or identity-resolution failure.

### Permanent contract
The bulk review endpoint must normalize the UI's scan-review identifier before UUID validation:

```text
scan:<uuid> → <uuid>
```

The API must then:
- validate the normalized value as a UUID;
- accept only authorized scan-review records belonging to the current organization;
- require an allowed bulk action;
- transition pending scan-review items to `rejected`;
- preserve the original scan evidence, scan job, and person records;
- write an auditable dismissal decision;
- return the number of actually dismissed records.

The existing audit rule remains:

**Dismissed reviews stay in the scan audit history.**

The API remains the security boundary. The frontend may continue using prefixed identifiers for UI identity, but server-side normalization and authorization must always be applied before mutation.

### Regression gate
Any future Review Center bulk-action change must verify:
1. selecting one scan review works;
2. selecting multiple scan reviews works;
3. `scan:<uuid>` identifiers are normalized to UUIDs at the API boundary;
4. unauthorized/nonexistent IDs cannot be dismissed;
5. dismissed items disappear from the pending queue;
6. original scan evidence and scan jobs remain intact;
7. the audit decision records the bulk dismissal;
8. duplicate groups cannot accidentally enter the scan-review bulk-dismissal path;
9. the UI does not show a generic `Invalid review action` error for a valid scan-review bulk dismissal.

This incident reinforces a general NYEOCARE rule:

**UI identifiers and persistence identifiers may differ, but every boundary must explicitly normalize the identifier contract before validation or mutation.**


### Follow-up root cause: PostgreSQL parameter typing in bulk dismissal
The first identifier normalization fix exposed a second, database-level defect in the bulk dismissal query. PostgreSQL could not infer the type of the `$3` parameter used inside `jsonb_build_object(..., 'selected_count', $3, ...)`, returning SQLSTATE `42P18` (`could not determine data type of parameter $3`).

The permanent fix explicitly casts the selected-count parameter to integer before passing it to `jsonb_build_object`.

This is a required lesson for parameterized JSON construction in NYEOCARE:

**When a PostgreSQL parameter is used in a polymorphic JSON function and its type cannot be inferred from surrounding SQL, cast it explicitly at the SQL boundary.**

The incident was verified in production runtime logs before the fix; the failing request was `POST /api/review/resolve` and the database error was SQLSTATE `42P18`.


## Production identity hardening — September 27, 2026: existing-register scans must recognize existing people before field review

- **Root cause confirmed in production:** scan job `812b6ad9-375b-40d8-8328-1e2e73aacf07` extracted 13 rows successfully but reported `0 existing recognized, 0 new remembered, 13 need your attention`. Several rows had exact existing-identity evidence. For example, the `Evelyn` row had exact name + exact normalized phone, candidate score 100, but was routed to Review Center because the resolver required `pair_evidence='clear'`; the current extraction contract can legitimately leave `pair_evidence` null while still reporting `phone_relation='same_row'` and clear phone/name evidence.
- **Permanent identity rule:** identity resolution and field-quality review are separate decisions. A strong existing identity must be recognized first. A field-level ambiguity may create a targeted review attached to that existing person, but it must not demote the identity to `needs_decision`, create a new person, or make the existing person disappear from the recognized scan result.
- **Strong evidence paths:** exact normalized name + exact unique phone resolves the existing person; exact unique phone with clear same-row evidence can resolve the existing person even when the transcribed name needs correction; a unique exact name can establish an existing identity when there is no conflicting exact phone owner, while phone discrepancies remain field-review evidence.
- **Explicit conflicts still win:** multiple exact name owners without a unique supporting phone, a phone belonging to another exact-name owner, contradictory same-page phone ownership, or genuinely ambiguous identity candidates remain Review Center decisions. ARIA must never force a merge merely to reduce review volume.
- **Row/pair inference:** when the vision model omits `pair_evidence` but explicitly provides `phone_relation='same_row'`, no same-page phone conflict, and no continuation/row-ownership uncertainty flag, the resolver may treat the phone-to-name linkage as sufficiently clear for identity scoring. This is an inference from existing visual evidence, not a guessed value rewrite.
- **Persistence order is mandatory:** for a resolved existing identity, update/touch the existing person and preserve the scan observation first; only then create a Review Center item for remaining field uncertainty. Never apply the old `needsIdentityReview || fieldReasons.length` gate because it incorrectly converted known identities into unresolved reviews.
- **Existing-register rescan expectation:** rescanning a register already represented in People must primarily refresh existing identity observations and last-scan memory. Review Center should contain only genuine unresolved identities or specific field corrections, not every row from the register.
- **Regression gate:** every scan identity change must test exact name + exact phone with omitted pair evidence; unique exact name with a non-exact phone; unique exact phone with a noisy/ambiguous name; duplicate exact names separated by a unique phone; explicit same-page phone conflicts; and strong existing matches carrying non-identity field-review reasons. Expected invariant: identity truth remains recognized whenever the identity evidence is strong enough, while field corrections remain auditable.


### Current scan reconciliation applied — scan job `812b6ad9-375b-40d8-8328-1e2e73aacf07`

- The production scan originally completed as `0 recognized / 0 new / 13 review` even though multiple rows had decisive existing-person evidence.
- The affected scan was reconciled without deleting evidence or People records: **9 scan rows are now attached to existing People, 4 exact/decisive rows were safely resolved from the Review Center, and 5 remain as field-level reviews attached to an existing person.** Four rows remain genuinely unresolved identity decisions because their evidence contains real conflicts/ambiguity.
- The scan job record was updated to reflect the post-scan reconciliation: `9 existing recognized / 0 new / 9 needing attention`, with the reconciliation source recorded in the verification metadata.
- Because two rows belonged to the same Happiness person, the reconciliation represents 9 recognized scan observations across 8 distinct existing People IDs.


## Production identity merge hardening — September 27, 2026: human-edited identities must merge without losing ARIA history

- **Observed production failure:** `POST /api/review/duplicate-action` returned HTTP 409 with `IDENTITY_HISTORY_CONFLICT` and the old message `Some history could not be safely combined. Nothing was changed.` at approximately 14:11 UTC. The merge endpoint's prior implementation attempted to move every history table with a generic `UPDATE person_id` operation, even when a table had its own logical uniqueness key.
- **Root architectural issue:** person identity history is not one flat foreign-key graph. ARIA learning, actions, events, observations, current state, intelligence snapshots, and relationships each have distinct uniqueness and reconciliation semantics. A safe merge must reconcile each domain before moving foreign keys.
- **Permanent merge contract:** merge is an explicit human identity decision. Once confirmed, the system preserves one canonical People record, combines compatible history, resolves logical uniqueness collisions deterministically, archives the duplicate rather than deleting it, records the human decision in `identity_pair_decisions`, and preserves an auditable `last_identity_merge` on the canonical person.
- **ARIA learning:** human-edited names already enter `person_aliases` and `aria_learning` through Review Center. A confirmed merge now also stores the merged record's former display name as a canonical identity alias/learning signal, so future scans can recognize that observed name as belonging to the surviving person. Current-image evidence still outranks learned history; learning is a recognition aid, not authority to merge automatically.
- **History reconciliation:** duplicate merges now have explicit reconciliation paths for `aria_learning`, `aria_actions`, `aria_events`, `aria_observations`, `person_relationships`, and the existing attendance, participation, memory, alias, role, custom-field, segment, relationship-score, engagement, intelligence, and ARIA-state paths. Logical duplicates are merged or discarded only where they represent the same keyed fact/action/event; unrelated history is retained.
- **Safety invariant:** any unexpected database error remains transactionally atomic — the canonical person, duplicate person, history, learning, and audit state must all roll back together. The user must never see a successful merge when only part of the person's history moved.
- **Regression gate:** test human-edited existing identities, explicit separate→later-merge flows, duplicate alias learning, overlapping ARIA action/event/learning keys, relationship collisions, ARIA person-state collisions, attendance/participation collisions, and full rollback on an unexpected constraint. The expected outcome is one surviving person with complete compatible history, one archived duplicate, durable aliases/learning, and no silent history loss.

### Regression case added — same-name duplicate records with one missing phone

A concrete production case established the required merge behavior:

- Person A: **Sister Blessing**, active, no phone, unverified.
- Person B: **Sister Blessing**, active, **+234 806 536 6272**, human-verified.
- Separate person: **Blessing Emelile**, **+234 206 619 9143**, must remain a completely different identity.

The duplicate-review action shown to the operator was for the **two Sister Blessing records**. It was not a merge request for Blessing Emelile.

The permanent rule is:

1. Exact normalized name may legitimately surface two database records as a possible duplicate.
2. A human may explicitly merge those two records when the records are confirmed to represent one person.
3. The merge must preserve compatible phone data; the verified phone must survive on the canonical record.
4. The merge must combine compatible history across its own uniqueness domains and archive only the duplicate record.
5. A different person such as Blessing Emelile must not be touched by that merge.
6. A prior scan decision that created Sister Blessing separately from Blessing Emelile remains a separate identity decision; it does not become a merge merely because another duplicate group is later merged.
7. Regression coverage must keep the same-name/one-phone-missing case, current-state collisions, and phone preservation.

This case exists because **“same name” and “same person” are not interchangeable**. Duplicate detection may surface the pair; only the explicit human merge decision establishes that these two records are one person.


## Production merge hardening follow-up — September 27, 2026: keep Review Center pointers attached to surviving identities

The people merge path must reconcile not only historical person rows but also active application pointers into the identity graph.

The scan_review_items.proposed_person_id field is a live pointer used by Review Center to associate a review with the person currently represented by that review. During a confirmed merge:

- resolved scan-review items whose proposed_person_id is the archived duplicate must be repointed to the surviving canonical person before the duplicate is archived;
- immutable scan evidence such as raw/extracted names, phones, evidence, candidates, and decision history must not be rewritten merely because the person identity was merged;
- the merge must leave Review Center capable of opening historical/resolved work without pointing at an archived identity as its current subject;
- regression coverage must explicitly guard the scan_review_items.proposed_person_id reconciliation.

This closes the remaining person-reference gap found by comparing every public table containing a person identifier against the production merge implementation.

## Production merge deployment gate — September 27, 2026

The human-confirmed duplicate merge hardening is incomplete until the production alias is actually running the same commit as `main`.

For identity-merge changes, deployment verification is mandatory:

1. Confirm `main` contains the merge reconciliation implementation and regression guards.
2. Confirm a new Vercel production deployment is created from the resulting `main` commit.
3. Confirm the deployment reaches READY before any operator retries a production merge.
4. Confirm production runtime logs for `/api/review/duplicate-action` no longer execute the legacy `IDENTITY_HISTORY_CONFLICT` path.
5. Retry the concrete same-name case only after the new deployment is live:
   - canonical candidate: `Sister Blessing` with verified `+2348065366272`;
   - duplicate candidate: `Sister Blessing` with no phone;
   - unrelated person: `Blessing Emelile` with `+2342066199143`, which must remain untouched.
6. Verify the post-merge database state: one active Sister Blessing, one archived duplicate, verified phone preserved, compatible history reconciled, merge audit recorded, alias/learning recorded, and Blessing Emelile still active and unchanged.
7. A production merge retry against an older deployment is explicitly considered a failed verification, not a user error.

This gate exists because repository correctness and production correctness are separate release states.


## Production experience hardening — September 27, 2026: Tell ARIA corrections must never block on derived intelligence

- **Observed production failure:** clicking **Tell ARIA → They attended** returned `timeout exceeded when trying to connect` from `POST /api/attendance/aria-correction`.
- **Exact root cause:** the endpoint correctly committed the human attendance correction first, but then kept its single serverless PostgreSQL client checked out while running engagement metrics, relationship scoring, people intelligence, ARIA person-state updates, and sometimes AI care-draft generation. NYEOCARE's bounded serverless pool uses `max:1` with a short connection timeout, so those post-commit operations could exhaust the only available client and turn a successful correction into a user-visible 500/timeout.
- **Important data-safety finding:** the failed response did **not** mean the human correction was lost. The transaction had already committed the attendance correction and timeline event before the later connection acquisition failed. Returning an error after a successful commit created a false failure in the UI.
- **Permanent interaction contract:** the synchronous request path must save the smallest human fact atomically, publish durable background work, commit, release the database client, and return immediately. Derived ARIA intelligence must not run inline after commit.
- **Attendance correction implementation:** `pages/api/attendance/aria-correction.js` now resets the closed session's ARIA processing state, enqueues the existing `nyeocare-attendance` PGMQ pipeline at `persist`, commits, and returns `202` with `processing_pending:true`. The durable worker recomputes the downstream attendance intelligence asynchronously.
- **User experience contract:** the Tell ARIA attendance modal closes immediately for an attendance confirmation. For an absence correction, the UI acknowledges the saved human fact and explains that ARIA is continuing in the background; it never makes the user wait for an AI draft.
- **Regression gates:** `test:critical-ui` now verifies that attendance correction is durable and non-blocking. A new `test:experience` contract sweep scans transactional API routes for the broader class of post-commit DB/AI work performed while a serverless client is still held.
- **CI/deployment gate:** `test:experience` runs before the remaining intelligence/auth/scale/field-mode suites and before the Vercel production build/deploy. A future endpoint that recreates this connection-lifetime pattern should fail CI before reaching production.
- **Audit method:** production experience review now combines (1) critical-path contract tests, (2) broad architectural hazard scans, (3) full regression/scale/auth suites, (4) production deployment verification, and (5) deployment-scoped runtime error scans. This does not mathematically prove the absence of all future bugs, but it makes this class of failure mechanically detectable rather than dependent on a user discovering it first.


## NYEOCARE Sentinel — Full-stack reliability and production diagnostics

### Purpose
Sentinel is the engineering safety layer for NYEOCARE. It is designed to turn production failures from user discoveries into observable, reproducible, triageable signals.

It covers:
- browser render failures and unhandled promise failures
- API 5xx/408/429 failures and client-observed slow API calls
- server-side unhandled route errors
- request correlation through `X-NYEO-Request-ID`
- database reachability and connection-pool pressure
- durable attendance queue state and worker availability
- stuck ARIA attendance processing
- expired ARIA actions and AI budget reservations
- aggregated diagnostic history reported by real authenticated users
- static high-confidence architecture hazards in CI
- production health checks after deployment and every 30 minutes

### Permanent interaction contract
The application must separate human-fact persistence from derived intelligence. A user-facing request should save the smallest durable fact atomically, release the database client, and return. Background intelligence belongs behind a durable queue or other recoverable async boundary.

### Browser telemetry
`components/ClientDiagnostics.js` installs once for the client runtime. It observes same-origin `/api/*` failures, network failures, and materially slow API calls without recording request bodies or authentication headers. Diagnostic reports are authenticated before persistence and are deduplicated into `system_diagnostic_events`.

### Server telemetry
`lib/apiHelpers.js` assigns or preserves a request ID and returns it through `X-NYEO-Request-ID`. Unhandled exceptions that escape an authenticated API handler are persisted as diagnostic events without blocking the API response path.

### Diagnostic storage
`system_diagnostic_events` is a server-written, RLS-enabled aggregation table. The same issue is incremented rather than creating one row per occurrence. Each record keeps severity, status, fingerprint, route, build, request ID, bounded message/stack context, first/last seen timestamps, and occurrence count.

### Sentinel surfaces
- `GET /api/health` is a safe public liveness/readiness probe.
- `/system/diagnostics` is an owner/admin control-room page.
- `GET/POST /api/system/diagnostics` returns current system checks and updates issue status.
- `npm run test:diagnostics` runs the repository-wide high-confidence architectural sweep.
- `.github/workflows/sentinel.yml` probes production every 30 minutes.
- Production CI performs a health probe immediately after deployment.

### What Sentinel does not claim
Sentinel does not mathematically prove that no future bug exists. It creates multiple independent detection layers so that frontend, backend, data/queue, deployment, and real-user failures become visible and actionable instead of remaining hidden until a user reports them.


## ARIA interaction hardening — September 28, 2026

### Tell ARIA is an intent-aware operating surface, not a form parser

Tell ARIA must reason from the shape and purpose of what an operator says or pastes instead of requiring a new command pattern for every natural variation.

For People/roster input, ARIA should recognize a roster task when the message contains multiple person-like rows and multiple phone-like values, especially when the surrounding language indicates names, phone numbers, contacts, women, members, a roster, or similar organizational context. The operator may include ordinary prose before, between, or after the facts.

The default durable payload for a roster import is **identity data**: person name and phone number. Incidental prose is not a person fact merely because it appears next to a row. Sentences such as “Please she's very strong”, “and this the names and phone number…”, or “Please let call them…” are task context and must be ignored by the People import unless the operator explicitly asks ARIA to remember that text as a person fact.

A phone-shaped value that is incomplete or otherwise invalid may remain attached to its intended person row so that the operator can review it; ARIA must not silently invent digits or normalize an uncertain number into a different value.

A name-only row remains a valid People candidate and may be imported without a phone. Existing People matching remains conservative: an exact name match with a conflicting existing phone must not overwrite the stored phone automatically.

This reasoning layer is deliberately deterministic for high-confidence structure because it is fast, auditable, and safer than calling an LLM for simple contact extraction. The conversational/AI layer may still interpret broader intent, but it should hand clear structured roster work to the canonical People mutation capability.

### Profile surface — one ARIA entry point

The Profile page must not contain a second ARIA guidance/editor surface. Profile is for organization, access, invitations, and account/security settings. ARIA interaction belongs to the global Tell ARIA experience and the canonical Today/Review surfaces. Do not reintroduce a duplicate “ARIA guidance” editor or launcher into Profile merely under a different label.


## ARIA Cognitive Conversation Architecture — September 28, 2026

### ARIA must understand intent before choosing a tool

Talk to ARIA is the natural-language operating surface for NYEOCARE. It must not behave as a collection of keyword-triggered commands.

For every user message, ARIA should internally separate:
1. the user's literal words;
2. the intended outcome;
3. the entities and scope involved;
4. facts or data contained in the message;
5. the capabilities currently available to this operator;
6. the smallest safe action that can move the request forward;
7. what is uncertain, blocked, unavailable, or requires human approval.

Natural English, imperfect English, shorthand, missing punctuation, voice transcription, pasted text, compressed contact lists, and mixed instructions/facts are valid inputs.

ARIA must never ask the user to translate an already understandable request into product terminology.

### Capability self-awareness is authoritative

The ARIA capability registry is the source of truth for what ARIA can currently do. Each capability describes whether it reads or mutates data, requires a person, requires explicit user intent, requires human approval, and whether owner/admin permission is required.

The capability catalog is available to ARIA during planning and response synthesis. When a user asks what ARIA can do, ARIA should explain the real current capability set in human language. It may group capabilities by purpose, but must not invent unsupported features.

When an action is not supported, ARIA should say that it cannot perform that action yet and identify the closest supported path. When an action is supported but permission-restricted, ARIA should say what role is needed. When execution fails, ARIA should distinguish attempted failure from unsupported capability and explain the next requirement at a safe level.

### Attempt → verify → recover

For supported actions:
- ARIA should attempt the smallest high-confidence safe action first.
- A successful capability result is the only basis for claiming completion.
- A failed capability must never be represented as successful.
- After failure, ARIA should reassess whether another existing capability can satisfy the same underlying goal before asking the user to repeat themselves.
- Consequential external actions remain approval-gated.

### Natural data-entry understanding

When a message contains both data and an instruction, ARIA separates them.

Example: a pasted roster containing names, phones, introductory sentences, comments, and a final request to contact people should be understood as:
- the names and phone numbers are People data;
- surrounding prose is task context unless explicitly requested as memory;
- incomplete/uncertain phone values remain visible for review rather than being guessed;
- the final requested outreach is a separate potential action and must obey the normal drafting/approval rules.

This separation applies even when the pasted content is flattened into one paragraph with no line breaks.

### Conversation disambiguation

Follow-up detectors must use the whole utterance. Common words such as “why”, “what”, “where”, or “tell” inside an otherwise ordinary sentence must not trigger a specialized observation or action flow.

For example, “Please let call them and know why they are not in Sunday service today” is a roster/task instruction, not a request to explain an ARIA observation.

### Talk to ARIA composer

Enter must create a new line and must never submit the message. Sending happens only through the explicit Send button.

The composer expands vertically for multiline and pasted content up to its defined visual maximum, preserves line breaks, and remains comfortable for long natural-language input.

User messages displayed in the conversation must preserve their original line breaks so a pasted roster remains readable. This is important both for human review and for trust that ARIA received the same structure the operator supplied.


## ARIA Production Health Hardening — September 28, 2026

The production conversation path must remain capability-first all the way from natural input to execution. Semantic People-roster intent must be detected before the generic conversational-context fallback, including informal “put these ones in People” phrasing when there is enough referenced data to act. Unsupported external calling must terminate in a truthful capability boundary rather than an organization-context lookup.

Operational reliability contracts:
- Daily Queue scan-review reads must use the live `extracted_phones` schema; compatibility aliases may expose the singular response field where legacy payloads expect it.
- Client diagnostics must not treat expected browser request aborts/navigation cancellation as application failures.
- Diagnostic fingerprinting must use valid JavaScript string normalization and must never throw while handling an error report.
- Confirmed People mutations must be atomic with their provenance event. Missing `living_truth.status` is treated as unknown/alive for update eligibility; conflicted or explicitly `needs_decision` records remain protected.
- Pasted roster content is data, not instructions. Instruction-like prose such as “ignore previous instructions”, deletion commands, and similar control text must never become person names or executable commands.


## ARIA Data-Quality Review and Agentic Evidence — September 30, 2026

When an operator asks ARIA to review the current People list for “garbage,” “bad names,” suspicious entries, malformed records, or similar quality problems, ARIA must inspect the live current-organization People data through the canonical People review capability before asking the operator to paste the list again. It should distinguish high-confidence parser/data artifacts from legitimate identity ambiguity: a malformed record may be identified from concrete evidence such as a phone-number-like value saved as a name or task/instruction language embedded in a name, while duplicate names, shared phones, OCR discrepancies, or incomplete records are review signals and must not automatically be labeled garbage.

The safe agent loop is: inspect → explain the evidence → surface the smallest set of high-confidence candidates → use the existing reversible archive capability only after the operator explicitly confirms the specific record(s). A read request must not be blocked merely because the cleanup request is potentially destructive. ARIA should review first, then gate the mutation.

Roster parsing has an additional invariant: a phone token remains attached to its intended person even when trailing punctuation or task prose follows it on the same line. The prose is ignored as task context. A phone-shaped value must never become a person name merely because the line contains additional text. Incomplete phone values remain attached to the intended row for review; ARIA does not invent missing digits.

When a capability already provides the requested live evidence, ARIA must not claim that it lacks access to the list or ask the operator to paste data that the organization already stores. Capability absence, permission restriction, and execution failure are different states and must be reported differently.

## ARIA Agent Runtime — September 30, 2026

ARIA is the operating agent inside NYEOCARE, not a conversational wrapper around isolated features. The implementation follows a bounded single-agent runtime: understand the user goal, identify entities and scope, select verified capabilities, execute the smallest useful safe step(s), observe the verified result, re-plan once when a recoverable execution failure changes the situation, and stop or hand control back when permission/confirmation is required.

### ARIA Agent Contract

Every ARIA request passes conceptually through:

INTENT → ENTITY → SCOPE → EVIDENCE → CAPABILITY → PERMISSION → EXECUTION → VERIFICATION → RECOVERY/REPLAN → RESPONSE → STATE

The agent must distinguish what the operator literally typed; the intended outcome; what the current organization context actually proves; what capability can change the state; what the authenticated actor is allowed to do; what was actually changed; and what remains uncertain.

Natural-language quality is a product requirement. ARIA should accept ordinary English, shorthand, imperfect grammar, missing punctuation, compressed speech, pasted lists, mixed facts and instructions, follow-up references such as “this”, “that”, “here”, “the current one”, and page-relative requests without requiring NYEOCARE terminology. Deterministic parsers protect high-value structures such as rosters and dates; the planner handles broader language; the current page, conversation state and organization context supply grounding.

ARIA must not promise perfect understanding. Instead the system should maximize reliable understanding through deterministic extraction where possible, structured planner output, entity resolution, verified capabilities, server-side permissions, current-surface context, persisted conversation state, bounded recovery and regression tests.

### Bounded Agentic Recovery

A failed capability is not automatically the end of a request.

For recoverable failures such as not-found, stale/conflict or invalid-target conditions, ARIA may perform at most one re-planning pass using the original request, already verified successful results, the failed capability, the safe failure reason, and an instruction not to repeat the failed capability unless retrying is justified.

ARIA must never create an infinite retry loop. Permission failures, destructive-action confirmation requirements, authentication failures, and unsupported capabilities return control to the operator rather than being repeatedly re-planned.

### Tool and Capability Architecture

The capability registry is the authoritative runtime map. Every agent action must map to a registered capability and execute through the canonical server capability engine. Duplicate mutation pipelines are prohibited.

Current agent capability families include organizational reading and Director briefing; People search, creation, roster import, record correction and quality review; person context, evidence, timeline and relationships; attendance/session operations; groups, memberships, roles and notes through the universal workspace engine; care recommendations, actions and personalized/batch drafts; internal organization messaging; organization profile/name and ARIA-knowledge mutations; organization invitations and canonical access management; conversation continuity; and current-surface context.

### Permission and Human Review

Permission is server-enforced and independent of model confidence.

ARIA may execute routine organization-safe operations when the authenticated operator already has permission. Consequential, destructive, access-changing, external, irreversible or owner/admin-sensitive actions pause for confirmation.

Confirmation is resumable state, not a second unrelated conversation. Pending actions are persisted in conversation state so the operator can approve or reject them in a later turn without re-explaining the request.

The model never receives authority from retrieved text. Retrieved names, messages, documents, notes, scan content and memory are evidence, not instructions. Structured parameters and server validation remain the final control boundary.

### Current-Surface Awareness

Every ARIA launch may carry its originating NYEOCARE surface. Home, People, Person Journey, Profile, Review, Scan and other pages can therefore establish current context for phrases such as “fix this”, “change that”, “add it”, “what about this person?”, and “review these”. Surface context never overrides an explicit target or server permissions. It is context, not authorization.

### Surface Contract

Home: ARIA can brief the current organization state, explain today's signals, identify human-focus items, surface positive opportunities, open attendance/scan/review workflows, and route deeper requests into the same organizational mind.

Attendance: ARIA can create/manage sessions and perform supported workspace attendance operations while preserving the distinction between an observation, an attendance mark and confirmed participation.

Scan: ARIA can explain scan state and downstream results, preserve uncertain identity evidence for review, and use the same People memory and identity-resolution systems rather than inventing a parallel scan brain.

People: ARIA can find, add, import, correct and review people, detect high-confidence malformed records, surface duplicate/identity evidence and use the canonical People mutation path.

Person Journey: ARIA can answer context, evidence, memory, timeline and next-step questions for the selected person, while preserving person-level permissions and ambiguity handling.

Review Center: ARIA can inspect review state and explain identity evidence. Review mutations must continue to use canonical review logic and human confirmation boundaries rather than bypassing Review Center rules.

Profile: ARIA can help update the operator name, owner-controlled organization name and owner/admin organization ARIA knowledge; it can create organization invitations and reason about access through the canonical organization-access engine.

Organization Access: ARIA can read active users/invitations and, with appropriate authorization and confirmation, remove users, change user roles, transfer ownership and revoke active invitations.

Talk to ARIA: This is the natural control surface over the same capabilities and memory. It must not become a separate feature implementation. Conversation continuity, surface context, pending actions and verified organization state remain shared.

### Organization Access Canonicalization

organization_invites is the canonical invitation table used by the current invite/join flow. Organization access reads and mutations should use the canonical access engine rather than maintaining separate UI and ARIA implementations.

The canonical access engine supports list organization users and invitations; remove an active user; change an active user's role; transfer ownership; and revoke an active invitation.

Self-removal is prohibited. Owner protection, admin restrictions and role transitions are server-enforced.

### Onboarding

Onboarding experience is per authenticated user, not global to the organization. A newly invited and successfully joined operator should receive the same appropriate onboarding framework as the owner, but copy and available explanations must be role-aware.

Profile onboarding must describe actual available functionality. Owner copy covers profile, organization name, access, invitations, responsibility changes, security and ARIA organization knowledge. Admin copy covers own profile, organization user/invitation management, security and ARIA organization knowledge. User copy covers own profile, organization access visibility, security and ARIA usage.

Onboarding descriptions must never promise controls that the current role cannot access.

### Bulk WhatsApp Draft Sessions

Batch drafting is preparation, not automatic sending.

ARIA may prepare many personalized WhatsApp drafts in bounded batches, validate phone readiness, deduplicate recipients and persist draft communications.

A WhatsApp session preserves ordered draft items, current index, batch identity, return/pending state and optional auto-advance preference.

The default operator flow is: open the current prepared chat; review and press Send in WhatsApp themselves; return to NYEOCARE; tap Next chat; continue with the next prepared draft. Auto-next remains optional. NYEOCARE never pretends it can place controls inside the external WhatsApp UI without a supported integration.

### Evidence and Data Quality

ARIA should identify high-confidence malformed data from concrete evidence, not from vague intuition. A phone-number-like value saved as a name or task/instruction language embedded in a People name may be a high-confidence parser artifact. Duplicate names, shared phones, OCR discrepancies and incomplete records are review signals, not automatic proof of garbage.

Cleanup flow: INSPECT → IDENTIFY → EXPLAIN EVIDENCE → CONFIRM → REVERSIBLE MUTATION → VERIFY RESULT

A read request for data quality must not be blocked merely because cleanup could later be destructive.

### Observability and Evaluation

Each consequential agent path should retain machine-readable context sufficient to answer: what the operator requested; what ARIA interpreted; what capability(s) were selected; which permissions applied; whether confirmation was required; what the server actually changed; and whether the run succeeded, failed, recovered or stopped.

Regression suites are part of the agent contract. New edge cases discovered in production should become deterministic tests or capability-level tests rather than living only in prompts.
