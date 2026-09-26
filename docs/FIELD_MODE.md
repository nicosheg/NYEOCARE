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
- the existing unique organization/person/session constraint remains the final idempotency boundary
- a late reconnect after another operator finalized the session is reconciled and the closed session is re-queued for durable ARIA processing

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
