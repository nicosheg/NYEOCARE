# NYEOCARE Field Mode

Field Mode is the attendance resilience layer for real Nigerian church/service conditions.

## Operating contract

Attendance persistence remains authoritative on the server, while an open attendance session also maintains a short-lived local field cache on the operator's device.

Online:
- optimistic mark
- server persistence through the existing canonical attendance endpoint
- ARIA remains asynchronous and never blocks the mark

Offline or degraded:
- roster and marks remain usable from IndexedDB
- each person/session mutation is coalesced to its latest state
- no repeated user retry action is required
- the outbox synchronizes automatically when connectivity returns

Reconnect:
- pending changes sync in bounded batches through /api/attendance/sync
- the server validates organization, session membership, people identity and active status
- a local outbox item is removed only after the server's canonical state matches the requested mark
- rejected/mismatched items stay on the originating account's device and show a reconciliation notice
- the existing unique organization/person/session constraint remains the final idempotency boundary
- a late reconnect after another operator finalized the session is reconciled and the closed session is re-queued for durable ARIA processing

## Cross-device contract

Every open attendance session uses the server as its source of truth and keeps a roster snapshot isolated to the currently signed-in account on that device.

- The device that starts attendance joins the session automatically; other authenticated organization users discover and join the active session when they open Attendance.
- Supabase Realtime provides fast updates when available. An authenticated, organization-scoped delta feed polls at a bounded interval as the fallback.
- A full roster snapshot must complete before incremental deltas are applied. If the snapshot or cursor bootstrap fails, the device retries rather than treating a partial first page as the whole roster.
- The delta feed carries newly created and edited people, inactive/archived people, and changed attendance records. This lets another open device reflect visitor additions, person edits, removals, and present/absent changes.
- Marking someone absent is stored as a shared `present=false` state instead of deleting the row. This is necessary so other devices can observe the unmark.
- Offline outbox entries are scoped to the signed-in account. Legacy entries that cannot be safely attributed are preserved for paper-sheet reconciliation instead of being uploaded as another operator.

### Two-device acceptance test

Run in an approved staging environment or a specifically authorized pilot service; do not create test records in a live church directory without approval.

1. Sign in as an owner/admin on device A and start a test attendance session.
2. Keep Attendance already open as a worker on device B. It should discover and join the session without a manual reload.
3. Mark one existing person present on B. A should show present within the polling interval if Realtime is unavailable.
4. Unmark that person on A. B should show absent; the row must not disappear or remain falsely present.
5. Add a clearly labelled test visitor on A. B should receive the record, and it must remain a Visitor (not a Member or Worker). Verify the phone is stored only after explicit contact consent; no message should be sent.
6. Disconnect B, make an offline mark, reconnect B, and verify the mark syncs or remains visibly queued for reconciliation if the server has a confirmed conflicting result.
7. Close attendance on one device. Both devices should stop offering live marks after the server confirms closure; no unconfirmed queued action should silently replace a confirmed record.
8. Verify the active People list and attendance totals in the same organization, then clean up the approved test records through the normal authorized workflow.

## Safety boundaries

The service worker caches only static assets. It does not cache authenticated application HTML or organization data.

Attendance local data is scoped to the current session and is removed after successful server finalization. Operators should use trusted devices.

Offline session creation is intentionally not supported yet because a new server session ID and organization lock must be created authoritatively online. Field Mode begins after an attendance session has been created.

## Performance instrumentation

The attendance surface emits bounded authenticated performance telemetry for:
- attendance open
- local/server search
- attendance mark
- attendance save

Additional application metrics can use the same prefix contract without storing personal names or phone numbers.

## Nigerian handwriting benchmark

Before making accuracy claims, use a real benchmark set of at least 100 handwritten rows and preferably 500+.

Measure independently:
- name accuracy
- phone accuracy
- row pairing accuracy
- duplicate/identity resolution accuracy

Include Nigerian names, continuation rows, split phone numbers, poor lighting, shadows/folds, different pens and handwriting quality. Store the source image and adjudicated truth so results can be reproduced.

## Pilot acceptance

A church pilot should measure:
- cold/warm load time
- attendance mark latency
- search latency
- offline queue size
- reconnect sync time
- session finalization time
- scan upload/OCR completion
- review/identity correction time
- ARIA processing completion
- failed request rate

The product claim remains organizational memory and intelligent care. The scanner is the doorway, not the whole product.

## Pilot verification
Run at least one real service with several operators, intentionally toggle airplane mode, restore connectivity, close from one operator, and verify all queued marks reconcile without manual retry.

## Offline cold-reopen contract

Field Mode must survive the operator closing and reopening the browser/PWA while disconnected after a real attendance session has been warmed on that device.

The service worker may cache the unauthenticated Home application shell because the shell contains no organization data. It must not cache authenticated API responses or organization/person records.

When the cached shell starts offline:
- Supabase's persisted browser session remains the authentication source;
- IndexedDB restores the active Field Mode session and roster;
- Attendance opens from local state without attempting a required network bootstrap;
- marks continue to update the local outbox immediately;
- reconnect handling resumes through the existing authenticated sync path.

This is a stronger requirement than merely keeping an already-open tab usable offline.
