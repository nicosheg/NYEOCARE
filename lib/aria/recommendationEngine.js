// lib/aria/recommendationEngine.js
import pool from '../db';

const ORDER = { critical: 4, high: 3, medium: 2, low: 1 };
const normalize = value => ORDER[value] ? value : 'medium';
const CONTACT_ACTION_TYPES = ['SEND_MESSAGE', 'CARE_FOLLOW_UP', 'FOLLOW_UP', 'CHECK_IN', 'CALL', 'VISIT', 'CARE_CONTACT'];

async function isDoNotContact(db, organizationId, personId) {
  await db.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
    ['nyeocare:do-not-contact:' + organizationId + ':' + personId]
  );
  const result = await db.query(
    `SELECT 1 FROM aria_care_contexts
     WHERE organization_id=$1 AND person_id=$2 AND kind='other'
       AND metadata->>'do_not_contact'='true'
       AND (ends_on IS NULL OR ends_on>=CURRENT_DATE)
     LIMIT 1`,
    [organizationId, personId]
  );
  return result.rows.length > 0;
}

export async function planActionFromObservation({
  organizationId, personId = null, observationId = null, actionType,
  priority = 'medium', actionMetadata = {}, actionKey = null
}, client = null) {
  if (!organizationId || !actionType) throw new Error('organizationId and actionType are required');
  const ownsClient = !client;
  const db = client || await pool.connect();

  try {
    if (ownsClient) await db.query('BEGIN');

    if (personId && CONTACT_ACTION_TYPES.includes(String(actionType).toUpperCase())) {
      if (await isDoNotContact(db, organizationId, personId)) {
        if (ownsClient) await db.query('COMMIT');
        return null;
      }
    }

    const key = actionKey || [organizationId, personId || 'global', actionType, observationId || 'none'].join(':');
    const metadata = { ...(actionMetadata || {}) };

    if (observationId) {
      const observed = await db.query(
        `SELECT type,confidence,severity,urgency,evidence,metadata,detected_at,expires_at
         FROM aria_observations WHERE id=$1 AND organization_id=$2 LIMIT 1`,
        [observationId, organizationId]
      );
      const row = observed.rows[0];
      if (row) {
        const evidence = row.evidence && typeof row.evidence === 'object' ? row.evidence : {};
        metadata.evidence_summary = {
          observation_id: observationId,
          type: row.type,
          confidence: Number(row.confidence) || 0,
          severity: row.severity || 'low',
          urgency: row.urgency || 'low',
          facts: Array.isArray(evidence.facts) ? evidence.facts.slice(0, 5) : [],
          inference: String(evidence.inference || '').slice(0, 800),
          sources: Array.isArray(evidence.sources) ? evidence.sources.slice(0, 5) : [],
          detected_at: row.detected_at || null,
          expires_at: row.expires_at || null
        };
      }
    }

    const result = await db.query(
      `INSERT INTO aria_actions(
         organization_id,person_id,observation_id,type,status,priority,
         action_metadata,action_key,proposed_at,expires_at
       )
       VALUES($1,$2,$3,$4,'proposed',$5,$6,$7,NOW(),
         CASE WHEN $6::jsonb->>'requires_confirmation'='true'
           THEN NOW()+INTERVAL '30 minutes' ELSE NULL END)
       ON CONFLICT(organization_id,action_key) DO NOTHING
       RETURNING *`,
      [organizationId, personId, observationId, actionType, normalize(priority), metadata, key]
    );

    if (ownsClient) await db.query('COMMIT');
    return result.rows[0] || null;
  } catch (error) {
    if (ownsClient) await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (ownsClient) db.release();
  }
}

export async function prepareAndApproveAction({
  organizationId, personId, actionType = 'SEND_MESSAGE', priority = 'medium',
  actionMetadata = {}, actorId
}) {
  if (!organizationId || !personId || !actorId) throw new Error('organizationId, personId and actorId are required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT * FROM aria_actions
       WHERE organization_id=$1 AND person_id=$2 AND type=$3 AND action_key=$4
         AND status IN('proposed','approved')
       ORDER BY CASE WHEN status='approved' THEN 0 ELSE 1 END,created_at DESC
       LIMIT 1 FOR UPDATE`,
      [organizationId, personId, actionType, `talk:${organizationId}:${personId}:${actionType}`]
    );
    let action = existing.rows[0] || null;
    if (!action) {
      action = await planActionFromObservation({
        organizationId, personId, actionType, priority,
        actionMetadata: { ...actionMetadata, requires_human_approval: true },
        actionKey: `talk:${organizationId}:${personId}:${actionType}`
      }, client);
    }
    if (!action) {
      throw Object.assign(new Error('This person has a do-not-contact restriction. No contact action was created.'), { status: 409, code: 'DO_NOT_CONTACT' });
    }
    if (action.status === 'approved') {
      await client.query('COMMIT');
      return action;
    }
    const approved = await client.query(
      `UPDATE aria_actions
       SET status='approved',approved_by=$3,approved_at=NOW(),updated_at=NOW(),
           action_metadata=COALESCE(action_metadata,'{}'::jsonb)||$4::jsonb
       WHERE id=$1 AND organization_id=$2 AND status='proposed'
       RETURNING *`,
      [action.id, organizationId, actorId, JSON.stringify(actionMetadata || {})]
    );
    if (!approved.rows.length) throw new Error('Action could not be approved.');
    await client.query('COMMIT');
    return approved.rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function approveAction(actionId, organizationId, userId) {
  if (!actionId || !organizationId || !userId) throw new Error('actionId, organizationId and userId are required');
  const result = await pool.query(
    `UPDATE aria_actions a
     SET status='approved',approved_by=$3,approved_at=NOW(),updated_at=NOW()
     FROM users u
     WHERE a.id=$1 AND a.organization_id=$2 AND a.status='proposed'
       AND a.approved_by IS NULL AND u.id=$3 AND u.organization_id=$2
       AND u.active=true AND u.role IN('owner','admin')
     RETURNING a.*`,
    [actionId, organizationId, userId]
  );
  return result.rows[0] || null;
}

export async function rejectAction(actionId, organizationId, reason = null) {
  if (!actionId || !organizationId) throw new Error('actionId and organizationId required');
  const result = await pool.query(
    `UPDATE aria_actions SET status='cancelled',failure_reason=$1,updated_at=NOW()
     WHERE id=$2 AND organization_id=$3 AND status IN('proposed','approved')
       AND COALESCE(action_metadata->>'first_visit_required','false')<>'true'
     RETURNING *`,
    [reason, actionId, organizationId]
  );
  return result.rows[0] || null;
}

export async function executeAction(actionId, organizationId) {
  if (!actionId || !organizationId) throw new Error('actionId and organizationId required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const initial = (await client.query(
      'SELECT person_id FROM aria_actions WHERE id=$1 AND organization_id=$2 LIMIT 1',
      [actionId, organizationId]
    )).rows[0];
    if (!initial) throw new Error('Action not found');
    if (initial.person_id && CONTACT_ACTION_TYPES.includes(String((await client.query(
      'SELECT type FROM aria_actions WHERE id=$1 AND organization_id=$2 LIMIT 1',
      [actionId, organizationId]
    )).rows[0]?.type || '').toUpperCase())) {
      if (await isDoNotContact(client, organizationId, initial.person_id)) {
        throw Object.assign(new Error('This person has a do-not-contact restriction. The contact action cannot proceed.'), { status: 409, code: 'DO_NOT_CONTACT' });
      }
    }
    const action = (await client.query(
      'SELECT * FROM aria_actions WHERE id=$1 AND organization_id=$2 LIMIT 1 FOR UPDATE',
      [actionId, organizationId]
    )).rows[0];
    if (!action) throw new Error('Action not found');
    if (action.status !== 'approved') throw new Error(`Action is not approved: ${action.status}`);
    if (action.expires_at && new Date(action.expires_at) <= new Date()) throw new Error('Action has expired');
    if (action.type === 'SEND_MESSAGE') {
      throw new Error('SEND_MESSAGE requires a confirmed external send; it cannot be marked executed by the manual WhatsApp flow.');
    }
    const updated = (await client.query(
      `UPDATE aria_actions SET status='executed',executed_at=NOW(),outcome=$1,updated_at=NOW()
       WHERE id=$2 AND organization_id=$3 AND status='approved' RETURNING *`,
      [{ success: true }, actionId, organizationId]
    )).rows[0] || null;
    await client.query('COMMIT');
    return updated;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function getPendingActions(orgId, limit = 20) {
  if (!orgId) throw new Error('orgId required');
  const n = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const result = await pool.query(
    `SELECT a.*,p.first_name,p.last_name,p.display_name,p.phone,p.email,
            o.type observation_type,o.severity,o.urgency,o.attention_score,o.evidence
     FROM aria_actions a
     LEFT JOIN people p ON p.id=a.person_id AND p.organization_id=a.organization_id
     LEFT JOIN aria_observations o ON o.id=a.observation_id AND o.organization_id=a.organization_id
     WHERE a.organization_id=$1 AND a.status IN('proposed','approved')
       AND COALESCE(a.action_metadata->>'kind','')<>'new_person_welcome'
       AND(a.expires_at IS NULL OR a.expires_at>NOW())
       AND(a.person_id IS NULL OR p.status='active')
       AND (
         a.person_id IS NULL
         OR upper(a.type)<>ALL($3::text[])
         OR NOT EXISTS(
           SELECT 1 FROM aria_care_contexts c
           WHERE c.organization_id=a.organization_id AND c.person_id=a.person_id
             AND c.kind='other' AND c.metadata->>'do_not_contact'='true'
             AND(c.ends_on IS NULL OR c.ends_on>=CURRENT_DATE)
         )
       )
     ORDER BY CASE a.priority WHEN'critical'then 4 WHEN'high'then 3 WHEN'medium'then 2 ELSE 1 END DESC,
              a.proposed_at ASC LIMIT $2`,
    [orgId, n, CONTACT_ACTION_TYPES]
  );
  return result.rows;
}

export async function getActionsForPerson(personId, orgId, limit = 20) {
  const n = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const result = await pool.query(
    `SELECT * FROM aria_actions WHERE person_id=$1 AND organization_id=$2
       AND COALESCE(action_metadata->>'attendance_history_reset','false')<>'true'
     ORDER BY created_at DESC LIMIT $3`,
    [personId, orgId, n]
  );
  return result.rows;
}

export async function generateActionsFromObservations(orgId) {
  if (!orgId) throw new Error('orgId required');
  const result = await pool.query(
    `SELECT o.id,o.person_id,o.type,o.attention_score,o.severity,o.urgency,o.evidence
     FROM aria_observations o
     LEFT JOIN people p ON p.id=o.person_id AND p.organization_id=o.organization_id
     WHERE o.organization_id=$1 AND o.status='active' AND o.attention_score>60
       AND(o.person_id IS NULL OR p.status='active')
     ORDER BY o.attention_score DESC,o.detected_at ASC`,
    [orgId]
  );
  const created = [];
  for (const observation of result.rows) {
    const action = await planActionFromObservation({
      organizationId: orgId,
      personId: observation.person_id,
      observationId: observation.id,
      actionType: 'SEND_MESSAGE',
      priority: observation.severity === 'critical' ? 'critical' : observation.severity === 'high' ? 'high' : 'medium',
      actionMetadata: { kind: 'care', reason: 'ARIA identified a meaningful care opportunity.', requires_human_approval: true, draft_required: true, channel: 'whatsapp' }
    });
    if (action) created.push(action);
  }
  return created;
}
