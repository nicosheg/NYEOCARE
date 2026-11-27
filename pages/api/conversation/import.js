// pages/api/conversation/import.js
import pool from '../../../lib/db';
import { withOrg } from '../../../lib/apiHelpers';
import { recordCareIntake } from '../../../lib/aria/careIntakeService';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clean = (value, max = 20000) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);

export default withOrg(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const personId = clean(body.person_id, 80);
  const transcript = clean(body.text, 1800);
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
  const client = await pool.connect();
  let result;

  try {
    await client.query('BEGIN');
    result = await recordCareIntake({
      client,
      organizationId,
      personId,
      actorId,
      actorRole,
      source: 'conversation_import',
      category: 'check_in',
      statement: transcript,
      summary: transcript.slice(0, 240),
      channel: 'other',
      privacyClass,
      consentConfirmed: body.consent_confirmed,
      contactPermission: 'unknown',
      idempotencyKey,
      additionalIntakeMetadata: { imported_conversation: true }
    });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[CONVERSATION IMPORT] failed:', error?.message || error);
    return res.status(error?.status || 500).json({
      error: error?.status ? error.message : 'Unable to record this conversation privately.'
    });
  } finally {
    client.release();
  }

  return res.status(result.duplicate ? 200 : 201).json({
    success: true,
    duplicate: result.duplicate,
    intake_event_id: result.event.id,
    extracted: 0,
    privacy_class: result.privacyClass,
    message: 'Conversation recorded privately for ARIA and authorized care review.'
  });
});
