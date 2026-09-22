# NYEOCARE — Living Product & Engineering Spec
**Documentary status date: 20 September 2026**

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

### Client image ingestion contract
Camera capture and gallery/file upload are different **sources**, not different vision pipelines. Before `/api/scan/start` receives an image, both sources must pass through the same deterministic browser preparation path:

```
CAMERA ─┐
        ├→ decode/orient → fit ≤3200px → high-quality JPEG → size guard → /api/scan/start
UPLOAD ─┘
```

The application must not have a fast path that sends small JPEG/PNG/WebP files raw while another source is canvas-normalized. That creates source-dependent pixels and makes scan quality regressions impossible to reason about. The canonical server-side `sharp.rotate() → resize → normalize → sharpen` stage remains in place after upload.

A source may still differ in the **photograph itself** — lighting, focus, framing, perspective and camera quality are physical differences — but once the browser prepares it, the transformation policy must be identical. Any future change to client image preparation must be benchmarked with the same physical register captured once by camera and once through file selection.

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

## Documentary record
**Last updated:** 20 September 2026

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
