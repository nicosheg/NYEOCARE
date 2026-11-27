# NYEOCARE Phase 1 — Production verification and E2E runbook

## What this gate protects

Phase 1 uses the existing ARIA event spine and care action/queue system. It does not add a second care-case table, task table, or intake store.

The canonical flow is:

1. An authorized operator records a report as CARE_INTAKE_RECORDED.
2. The event retains reporter, role, source, evidence kind, verification state, confidence, consent and privacy classification.
3. An authorized leader records an immutable CARE_INTAKE_REVIEWED decision.
4. Only an explicit approval creates one manual_care_responsibility in aria_actions.
5. aria_daily_queue_items projects that action into the assigned operator's work.
6. A human records the actual outcome through the existing follow-up completion path.

Private intake does not become a shared aria_observations row, person memory, organization memory or shared learning item. Similar-looking reports remain separate evidence. The idempotency key suppresses a replay of the same request; it is not fuzzy matching.

## Automated gate

Run these from the repository root:

`bash
npm run test:care-intake-foundation
npm run test:care-production-gate
npm run build
`

The production-gate source checks are part of CI. They protect the cross-file contract: canonical intake, explicit human review, role checks, consent, provenance, retry behavior, no-contact enforcement, private-event isolation, and the existing action/queue architecture.

For a live, read-only database audit, set CARE_PRODUCTION_GATE_DATABASE_URL to a trusted PostgreSQL connection string and run:

`bash
CARE_PRODUCTION_GATE_DATABASE_URL='YOUR_READ_ONLY_DATABASE_URL' npm run test:care-production-gate
`

The live audit runs inside BEGIN READ ONLY and checks the production indexes, immutable event trigger, private helper privileges, RLS, no-contact trigger, duplicate responsibilities, consent/narrative violations and known private-event leakage paths. It prints counts only; it does not read out care narratives or change records. Never put a database password in source control, a chat message, or a command history that other people can read.

## One intake writer for forms, chat, imports and private notes

`lib/aria/careIntakeService.js` is the shared, transaction-bound writer used by consented identified-person care forms, imported conversations, ARIA chat's `record_care_intake` capability and ARIA workspace private notes. It checks the active person in the tenant, requires operator-attested consent, enforces the category privacy minimum, uses a stable event key and payload fingerprint, and appends one immutable `CARE_INTAKE_RECORDED` event with provenance. The caller owns the transaction so it can atomically append other domain-specific events when needed.

ARIA chat does not infer consent or contact permission. A chat report requires an explicit operator instruction to save the report, one named person, the original report text, the person's explicit agreement to storage, a confidentiality classification and a UUID idempotency key. Contact permission defaults to unknown. It creates evidence only, not an assigned responsibility, message, call, visit or queue item. An authorized human reviews it through the existing intake-review flow.

The intake API retains a narrow fallback path for anonymous or non-consented reports and explicit do-not-contact requests, because those have separate consent-withholding or outbound-cancellation side effects. These fallback events still use `CARE_INTAKE_RECORDED` and must remain private when details are not permitted. Reusing an idempotency key with different content must fail with HTTP 409.

## Server-owned ARIA event processing

The application now has one organization-independent worker entry point at `POST /api/aria/process-events`. A scheduled GitHub Actions workflow claims up to 100 due events per run. The endpoint retains the existing event-claim, retry and dead-letter rules; the private-event processor guard remains in place.

The workflow is **opt-in and inactive until configured**. Do not treat the existence of the workflow file as proof that background processing is running.

1. In the Vercel project, add `CRON_SECRET` to the **Production** environment. Generate a fresh 32-byte random value locally (for example, `openssl rand -hex 32`). Do not paste it into source control or this runbook.
2. In GitHub repository Settings → Secrets and variables → Actions → Secrets, add `NYEOCARE_CRON_SECRET` with the exact same value.
3. In GitHub repository Settings → Secrets and variables → Actions → Variables, add `NYEOCARE_ENABLE_EVENT_WORKER` with value `true`.
4. Redeploy the Production deployment so the Vercel Function receives the new environment variable.
5. Run the **NYEOCARE ARIA Event Worker** workflow once with workflow_dispatch. Confirm the response reports `ok: true`, then verify the scheduled workflow continues to run. The GitHub schedule is best-effort scheduling, not a real-time delivery guarantee.

The workflow calls only the production worker endpoint and sends the secret in the Authorization header. The job is skipped when the repository variable is absent or not `true`. If the secret is absent or mismatched, the endpoint must return unauthorized; never weaken the endpoint to make the schedule pass.

## Private person context notes

Person Journey **Add note**, Community **Add pastoral note**, and ARIA workspace `add_note` are now private `CARE_INTAKE_RECORDED` evidence with category `context_note`. The category is always at least sensitive, requires explicit consent, preserves the reporter and evidence provenance, and is visible only to the reporter and authorized care leaders/admins. Context notes do not create responsibilities and are excluded from the intake-review queue; they remain visible in the Person Journey's Private care context section to operators whose role permits access.

The old `POST /api/timeline` note path, the old People Operating System note route, and generic `addTimelineEvent` / `recordJourneyEvent` note calls now reject note-shaped writes. Other operational timeline events such as lifecycle changes and confirmed manual communication events remain separate timeline projections.

## Canonical Person Journey care and conversation imports

The Person Journey **Add care** action uses the same shared responsibility writer as intake review. It writes one private `CARE_INTAKE_RECORDED` event, one explicit `CARE_INTAKE_REVIEWED` approval, one `aria_actions` responsibility and the existing queue projection. It requires the operator to attest that the person agreed to the recording; category minimums can elevate privacy to restricted. Sensitive narrative stays in the private event, not in shared action summary/message fields.

Conversation import is evidence capture, not a communication sent by NYEOCARE. It requires consent and a stable idempotency key, defaults to restricted privacy, and stores one canonical private care event. It no longer writes the same transcript into both `person_communications` and `timeline_events`, and it does not run external AI extraction into shared timeline records. ARIA's person-context/evidence capabilities retrieve the private event only for an authorized reporter or role. Person Journey ARIA conversation transcripts are limited to their owner and owner/admin viewers.

## Required E2E environment

A real role-boundary E2E test needs at least four distinct authenticated accounts in the same test organization:

- Reporter: an ordinary worker/user who records the report.
- Unrelated operator: another worker/user who did not report it.
- Care leader: can review sensitive care but not restricted care.
- Owner/admin: can review both sensitive and restricted care.

Use a disposable QA person and a separate test organization/database. Before using a Vercel Preview URL for write tests, verify its Supabase environment variables point to that isolated test database. A Preview URL can still be connected to production data; the hostname alone does not make writes safe.

Do not seed fake people or care reports in Havilah production just to test this flow. CARE_INTAKE_RECORDED and CARE_INTAKE_REVIEWED are intentionally immutable audit records. Without an isolated test database, use the automated source checks and read-only database audit only; defer write E2E until a safe test environment and test accounts are available.

## E2E scenarios and expected results

### 1. Anonymous report with unknown consent

Sign in as the Reporter. Open the care intake surface. Do not select a person, leave consent as unknown, enter a harmless test sentence, and submit.

Expected:
- One CARE_INTAKE_RECORDED event is created.
- No person is linked.
- Narrative statement and summary are withheld.
- The event is restricted because anonymous narrative was supplied without consent.
- No action, task, queue item, message or outreach draft is created.
- The reporter can see the report; unrelated operators cannot see restricted details.

### 2. Identified report with unknown consent

Select the disposable QA person, leave consent unknown, add a harmless sentence and submit.

Expected:
- The report is stored with consent_status unknown and restricted privacy.
- Narrative content is withheld.
- No identifiable responsibility can be approved from this report.
- A leader attempting approval receives a clear conflict response; no action or queue item is written.

### 3. Restricted category

Submit a prayer request, personal need or complaint for the QA person. Do not grant consent.

Expected:
- Privacy is restricted regardless of a less restrictive client-selected value.
- Narrative content is withheld.
- The reporter and owner/admin can view it.
- The unrelated operator and care leader cannot view the restricted report.
- No responsibility is created.

### 4. Sensitive category and role boundary

Submit a first-visit, check-in, practical-support or relationship request for the QA person with explicit consent granted.

Expected:
- Privacy is at least sensitive.
- Reporter, care leader and owner/admin can view it.
- An unrelated operator cannot view the report.
- The report remains evidence only until a leader explicitly approves it.

### 5. Approve and assign

As the care leader, review the consented sensitive report. Select an active authorized assignee, a clear task title and a due date within the allowed window. Approve it.

Expected:
- One immutable CARE_INTAKE_REVIEWED event records the decision.
- Exactly one aria_actions row is created with kind manual_care_responsibility.
- The action carries source_intake_event_id, assigned_user_id, due_date and privacy metadata.
- One follow-up queue projection appears for the assigned operator.
- No message is sent automatically.

### 6. Retry and duplicate behavior

For an API-level retry test, resend the exact same request body with the same idempotency_key after simulating a lost response. Repeat for a review decision using its same idempotency key.

Expected:
- A replay returns the existing event/action result.
- It does not create a second intake event, review decision, action or queue projection.
- A changed payload uses a new idempotency key and remains a separate report.
- Two similar reports from different occasions are not merged automatically.

### 7. No-contact enforcement

Record a direct do_not_contact preference for the disposable QA person. Then attempt to create a draft, approve a new outreach responsibility, and record a new outbound communication.

Expected:
- Active no-contact wins over any stale or client-supplied allowed value.
- Existing unsent outbound drafts are cancelled.
- Contact-oriented actions and pending queue projections are cancelled.
- Intake and follow-up no-contact outcomes invoke the same transaction-bound `persistDoNotContact` function; only the current responsibility being completed is excluded from cancellation.
- New outbound communication is blocked by the database trigger.
- Historical sent messages remain historical; they are not rewritten as unsent.
- There is no ordinary UI action that silently reactivates contact.

### 8. Outcome and confidentiality

Complete the assigned responsibility using each applicable outcome in the test environment: completed, unable_to_complete and person_declined. Use a private note in at least one case.

Expected:
- The outcome is attached to the correct action/person and original intake provenance.
- Unsuccessful outcomes require the prescribed explanation and are not counted as successful completion.
- Private notes stay inside their privacy scope and do not enter general timeline/activity, shared learning or organization-wide metrics.
- Drafting a message does not mark work complete and does not send anything.

## Production release gate

A Phase 1 release is accepted only when all are true:

- The durable ARIA worker reclaims `processing` events whose worker lease expired after five minutes; after the eighth failed attempt, the row is terminalized as `dead` instead of remaining stuck.
- The automated care-foundation and production-gate checks pass.
- CI build passes.
- The Vercel production deployment is READY for the exact main commit.
- GET /api/health returns status=ok, database=ok, workers=ok, queue=ok or busy, and build_id equal to that commit.
- The live read-only database audit passes.
- The role-based write E2E scenarios pass in an isolated database.
- No care narrative or private identity detail is exposed in shared surfaces.
- No duplicate responsibility, no-contact bypass or consent violation is observed.

A READY deployment by itself is not E2E acceptance. Keep the final status as verification-pending until the role-based write scenarios have actually run.

- `createCareFeedbackRowsInTransaction` and `linkCareFeedbackEventInTransaction` in `lib/aria/feedbackEngine.js` are the only core feedback/outcome row writers. Both the general feedback API, ARIA workspace, first-visit attendance welcome and follow-up completion use them; attendance and follow-up retain their own larger transactions to coordinate attendance/contact records, action status and queue projection atomically.
- Every persisted feedback and outcome pair is linked to its immutable source ARIA event through `source_event_id` before commit. Private feedback is excluded from shared timeline writes and shared learning.
- Event-processing failures roll back partial work before retry state is written. The failed attempt counter is then incremented outside the rolled-back transaction, so the eight-attempt ceiling actually applies.
## Release isolation gate

- Do not deploy a branch preview while its Preview environment resolves to the live NYEOCARE Supabase project or production service-role key.
- Create or provision a separate QA database, then set Preview-only DATABASE_URL, Supabase URL, anon key and service-role key to that QA project before enabling write-path verification.
- Run intake, human review, responsibility creation, follow-up completion, no-contact suppression, private-context visibility and event-worker recovery scenarios against QA identities only. Never seed or mutate Havilah production records to test these flows.
- Production event-worker activation is a separate release step: configure Vercel Production CRON_SECRET, the matching GitHub Actions secret NYEOCARE_CRON_SECRET, and repository variable NYEOCARE_ENABLE_EVENT_WORKER=true only after the endpoint and secret rotation are verified.
