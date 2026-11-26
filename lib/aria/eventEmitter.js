// lib/aria/eventEmitter.js
import pool from '../db';

const PRIVACY_CLASSES = new Set(['standard', 'sensitive', 'restricted']);
const CONSENT_STATES = new Set(['unknown', 'granted', 'declined', 'withdrawn', 'not_required']);

export async function emitAriaEvent({
  organizationId,
  personId = null,
  type,
  actorId = null,
  actorRole = null,
  source,
  metadata = {},
  eventKey = null,
  occurredAt = null,
  evidenceKind = 'observation',
  confidence = 1,
  verificationStatus = 'observed',
  scopeLevel = 'organization',
  expiresAt = null,
  supersedesEventId = null,
  privacyClass = 'standard',
  consentStatus = 'unknown'
}, client = null) {
  if (!organizationId) throw new Error('organizationId is required');
  if (!type) throw new Error('type is required');
  if (!source) throw new Error('source is required');
  if (!PRIVACY_CLASSES.has(privacyClass)) throw new Error('Invalid ARIA event privacyClass');
  if (!CONSENT_STATES.has(consentStatus)) throw new Error('Invalid ARIA event consentStatus');

  const key = eventKey || [source, organizationId, type, personId || 'global', Date.now()].join(':');
  const db = client || pool;
  const safeConfidence = Math.max(0, Math.min(1, Number(confidence) || 0));
  const safeMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};

  const result = await db.query(
    `INSERT INTO aria_events(
      organization_id,person_id,type,actor_id,actor_role,source,metadata,event_key,
      occurred_at,evidence_kind,confidence,verification_status,scope_level,expires_at,
      supersedes_event_id,privacy_class,consent_status,processing_status,processing_attempts
    )
    VALUES(
      $1::text,$2::uuid,$3::text,$4::uuid,$5::text,$6::text,$7::jsonb,$8::text,
      COALESCE($9::timestamptz,NOW()),$10::text,$11::numeric,$12::text,$13::text,
      $14::timestamptz,$15::uuid,$16::text,$17::text,'pending',0
    )
    ON CONFLICT(organization_id,event_key) DO NOTHING
    RETURNING *`,
    [
      organizationId, personId, type, actorId, actorRole || null, source, safeMetadata,
      key, occurredAt || null, evidenceKind, safeConfidence, verificationStatus,
      scopeLevel, expiresAt || null, supersedesEventId || null, privacyClass, consentStatus
    ]
  );

  return result.rows[0] || null;
}
