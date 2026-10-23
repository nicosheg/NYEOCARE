// pages/api/daily-queue/complete-follow-up.js
import pool from '../../../lib/db';
import { withOrg } from '../../../lib/apiHelpers';
import { emitAriaEvent } from '../../../lib/aria/eventEmitter';
import { processAriaEvent } from '../../../lib/aria/eventProcessor';
import { learnFromFeedback } from '../../../lib/aria/learningEngine';

const OUTCOMES = {
  met_in_person: { label: 'Welcomed in person', feedbackType: 'other', sentiment: 'positive' },
  reached: { label: 'Reached and checked in', feedbackType: 'other', sentiment: 'neutral' },
  no_response: { label: 'Attempted contact; no response', feedbackType: 'no_response', sentiment: 'neutral' },
  no_contact_details: { label: 'No usable contact details', feedbackType: 'new_information', sentiment: 'neutral' },
  already_connected: { label: 'Already connected by a person', feedbackType: 'other', sentiment: 'positive' },
  not_first_visit: { label: 'Confirmed this was not a first-time visit', feedbackType: 'other', sentiment: 'neutral' },
  do_not_contact: { label: 'Person asked not to be contacted', feedbackType: 'negative', sentiment: 'negative' }
};

export default withOrg(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const queueItemId = String(req.body?.queue_item_id || '').trim();
  const outcome = String(req.body?.outcome || '').trim();
  const note = String(req.body?.note || '').trim().slice(0, 1000);
  const option = OUTCOMES[outcome];
  if (!queueItemId || !option) {
    return res.status(400).json({ error: 'A queue item and valid first-visit outcome are required.' });
  }

  const client = await pool.connect();
  let event = null;
  let feedback = null;
  let personId = null;
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('nyeocare:daily-queue:'||$1,0))", [req.org.id]);

    const lookup = await client.query(
      `SELECT q.id queue_item_id,q.status queue_status,q.task_kind,q.source_id,
              a.id action_id,a.person_id,a.status action_status,a.action_metadata,
              p.display_name,p.first_name,p.last_name
       FROM aria_daily_queue_items q
       JOIN aria_actions a ON a.id::text=q.source_id AND a.organization_id=q.organization_id
       JOIN people p ON p.id=a.person_id AND p.organization_id=a.organization_id
       WHERE q.id=$1 AND q.organization_id=$2 AND q.assigned_user_id=$3 AND q.task_kind='follow_up'
       FOR UPDATE OF q,a`,
      [queueItemId, req.org.id, req.user.id]
    );
    const row = lookup.rows[0];
    if (!row || !['pending', 'deferred'].includes(row.queue_status)) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'This follow-up is no longer assigned to you.' });
    }
    if (row.action_metadata?.first_visit_required !== true ||
        row.action_metadata?.kind !== 'first_session_check_in' ||
        !['proposed', 'approved'].includes(row.action_status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Only an open required first-visit task can be completed here.' });
    }
    personId = row.person_id;
    const context = {
      source: 'required_first_visit_follow_up',
      outcome,
      outcome_label: option.label,
      queue_item_id: queueItemId,
      action_id: row.action_id,
      session_id: row.action_metadata?.session_id || null,
      service_key: row.action_metadata?.service_key || null,
      note
    };

    feedback = (await client.query(
      `INSERT INTO care_feedback(
        organization_id,person_id,action_id,actor_id,feedback_type,sentiment,note,context,
        observed_at,evidence_kind,verification_status,confidence,created_at,updated_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NOW(),'human_report','reported',1,NOW(),NOW())
      RETURNING id,feedback_type,sentiment,observed_at`,
      [req.org.id, row.person_id, row.action_id, req.user.id, option.feedbackType, option.sentiment, note, JSON.stringify(context)]
    )).rows[0];

    await client.query(
      `INSERT INTO intelligence_outcomes(
        organization_id,person_id,action_id,action_type,outcome,outcome_score,evidence,actor_id,
        feedback_id,observed_at,evidence_kind,verification_status,confidence,created_at
      ) VALUES($1,$2,$3,'first_visit_follow_up',$4,NULL,$5::jsonb,$6,$7,NOW(),'human_report','reported',1,NOW())`,
      [req.org.id, row.person_id, row.action_id, outcome, JSON.stringify(context), req.user.id, feedback.id]
    );

    await client.query(
      `INSERT INTO timeline_events(people_id,event_type,title,description,metadata,source,occurred_at,created_at)
       VALUES($1,'first_visit_follow_up','First-visit follow-up disposition',$2,$3::jsonb,'human',NOW(),NOW())`,
      [row.person_id, option.label + (note ? ': ' + note : ''), JSON.stringify(context)]
    );

    if (outcome === 'do_not_contact') {
      await client.query(
        `INSERT INTO aria_care_contexts(
          organization_id,person_id,kind,starts_on,ends_on,service_type,note,metadata,created_by
        ) VALUES($1,$2,'other',CURRENT_DATE,NULL,NULL,$3,$4::jsonb,$5)`,
        [req.org.id, row.person_id, 'Person asked the organization not to initiate further contact.', JSON.stringify({
          do_not_contact: true,
          source: 'required_first_visit_follow_up',
          source_action_id: row.action_id,
          human_reported: true
        }), req.user.id]
      );
    }

    const storedOutcome = {
      required_first_visit_follow_up: true,
      result: outcome,
      label: option.label,
      note,
      completed_by: req.user.id,
      completed_at: new Date().toISOString()
    };
    await client.query(
      `UPDATE aria_actions SET status='executed',executed_at=NOW(),outcome=$1::jsonb,
         failure_reason=NULL,updated_at=NOW()
       WHERE id=$2 AND organization_id=$3 AND status IN('proposed','approved')`,
      [JSON.stringify(storedOutcome), row.action_id, req.org.id]
    );
    await client.query(
      `UPDATE aria_daily_queue_items SET status='completed',completed_at=NOW(),
         payload=COALESCE(payload,'{}'::jsonb)||$1::jsonb,updated_at=NOW()
       WHERE id=$2 AND organization_id=$3 AND assigned_user_id=$4`,
      [JSON.stringify({ first_visit_outcome: storedOutcome }), queueItemId, req.org.id, req.user.id]
    );

    event = await emitAriaEvent({
      organizationId: req.org.id,
      personId: row.person_id,
      type: 'CARE_FEEDBACK',
      source: 'human',
      actorId: req.user.id,
      actorRole: req.user.role,
      evidenceKind: 'human_report',
      verificationStatus: 'reported',
      confidence: 1,
      metadata: {
        feedback_id: feedback.id,
        feedback_type: option.feedbackType,
        sentiment: option.sentiment,
        statement: note || option.label,
        outcome: { outcome, action_id: row.action_id, feedback_id: feedback.id },
        follow_up_context: context
      },
      eventKey: 'first-visit-follow-up:' + row.action_id
    }, client);

    await client.query('COMMIT');

    // A failed background learning refresh must not undo the operator's recorded outcome.
    if (event) {
      try { await processAriaEvent(event); } catch (error) {
        console.error('[ARIA] First-visit follow-up event processing failed:', error?.message || error);
      }
    }
    try {
      await learnFromFeedback({
        organizationId: req.org.id,
        personId: row.person_id,
        feedbackId: feedback.id,
        actionId: row.action_id,
        feedbackType: option.feedbackType,
        sentiment: option.sentiment,
        context,
        actorId: req.user.id
      });
    } catch (error) {
      console.error('[ARIA] First-visit follow-up learning failed:', error?.message || error);
    }

    return res.status(200).json({ success: true, completed: true, outcome, feedback_id: feedback.id });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[ARIA] Follow-up completion error:', error?.message || error);
    return res.status(500).json({ error: 'ARIA could not save this outcome safely. The follow-up remains open.' });
  } finally {
    client.release();
  }
});
