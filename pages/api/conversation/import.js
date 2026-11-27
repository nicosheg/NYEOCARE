// pages/api/conversation/import.js
import crypto from 'node:crypto';
import pool from '../../../lib/db';
import { withOrg } from '../../../lib/apiHelpers';
import { emitAriaEvent } from '../../../lib/aria/eventEmitter';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clean = (value, max = 20000) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);

export default withOrg(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const personId = clean(body.person_id, 80);
  const transcript = clean(body.text, 20000);
  const idempotencyKey = clean(body.idempotency_key || req.headers['idempotency-key'], 100);
  const privacyClass = String(body.privacy_class || 'restricted').toLowerCase();

  if (!UUID.test(personId) || !transcript) {
    return res.status(400).json({ error: 'person_id and conversation text are required.' });
  }
  if (transcript.length < 8) {
    return res.status(400).json({ error: 'Add a little more context before importing the conversation.' });
  }
  if (!UUID.test(idempotencyKey)) {
    return res.status(400).json({ error: 'A UUID idempotency_key is required so retries cannot duplicate the record.' });
  }
  if (body.consent_confirmed !== true) {
    return res.status(409).json({ error: 'Confirm that the person agreed for this conversation to be recorded for their care.' });
  }
  if (!['sensitive', 'restricted'].includes(privacyClass)) {
    return res.status(400).json({ error: 'Imported conversations must be confidential or restricted.' });
  }

  const organizationId = req.org.id;
  const actorId = req.user.id;
  const actorRole = String(req.user.role || '').toLowerCase();
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    personId, transcript, privacyClass
  })).digest('hex');
  const eventKey = 'conversation-import:' + idempotencyKey;
  const client = await pool.connect();
  let event;
  let duplicate = false;

  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      ['nyeocare:conversation-import:' + organizationId + ':' + idempotencyKey]
    );

    const person = (await client.query(
      "SELECT id FROM people WHERE id=$1 AND organization_id=$2 AND COALESCE(status,'active')='active' LIMIT 1 FOR SHARE",
      [personId, organizationId]
    )).rows[0];
    if (!person) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Person not found or no longer active.' });
    }

    const existing = (await client.query(
      "SELECT * FROM aria_events WHERE organization_id=$1 AND event_key=$2 AND type='CARE_INTAKE_RECORDED' LIMIT 1 FOR UPDATE",
      [organizationId, eventKey]
    )).rows[0] || null;
    if (existing) {
      if (existing.metadata?.request_fingerprint !== fingerprint) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This request key has already been used for different conversation content. Reopen the form to start a new import.' });
      }
      event = existing;
      duplicate = true;
    } else {
      event = await emitAriaEvent({
        organizationId,
        personId,
        type: 'CARE_INTAKE_RECORDED',
        actorId,
        actorRole,
        source: 'conversation_import',
        evidenceKind: 'human_report',
        verificationStatus: 'reported',
        confidence: 1,
        privacyClass,
        consentStatus: 'granted',
        eventKey,
        metadata: {
          request_fingerprint: fingerprint,
          intake: {
            category: 'check_in',
            statement: transcript,
            summary: transcript.slice(0, 240),
            reporter_user_id: actorId,
            captured_by: actorId,
            contact_permission: 'unknown',
            channel: 'conversation_import',
            imported_conversation: true,
            consent_capture: {
              confirmed: true,
              method: 'operator_attestation',
              confirmed_by: actorId,
              confirmed_at: new Date().toISOString()
            }
          }
        }
      }, client);
      if (!event) throw new Error('The conversation could not be recorded.');
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[CONVERSATION IMPORT] failed:', error?.message || error);
    return res.status(error?.status || 500).json({ error: 'Unable to record this conversation privately.' });
  } finally {
    client.release();
  }

  return res.status(duplicate ? 200 : 201).json({
    success: true,
    duplicate,
    intake_event_id: event.id,
    extracted: 0,
    message: 'Conversation recorded privately for ARIA and authorized care review.'
  });
});
