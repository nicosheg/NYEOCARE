// pages/api/daily-queue/complete-follow-up.js
import pool from '../../../lib/db';
import { withOrg } from '../../../lib/apiHelpers';
import { emitAriaEvent } from '../../../lib/aria/eventEmitter';
import { processAriaEvent } from '../../../lib/aria/eventProcessor';
import { learnFromFeedback } from '../../../lib/aria/learningEngine';

const OUTCOMES = {
  met_in_person: { label: 'Welcomed in person', feedbackType: 'other', sentiment: 'positive' },
  message_sent: { label: 'Follow-up message sent', feedbackType: 'other', sentiment: 'neutral' },
  reached: { label: 'Reached and checked in', feedbackType: 'other', sentiment: 'neutral' },
  no_response: { label: 'Attempted contact; no response', feedbackType: 'no_response', sentiment: 'neutral' },
  no_contact_details: { label: 'No usable contact details', feedbackType: 'new_information', sentiment: 'neutral' },
  already_connected: { label: 'Already connected by a person', feedbackType: 'other', sentiment: 'positive' },
  not_first_visit: { label: 'Confirmed this was not a first-time visit', feedbackType: 'other', sentiment: 'neutral' },
  do_not_contact: { label: 'Person asked not to be contacted', feedbackType: 'new_information', sentiment: 'neutral' }
};

export default withOrg(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const queueItemId = String(req.body?.queue_item_id || '').trim();
  const outcome = String(req.body?.outcome || '').trim();
  const note = String(req.body?.note || '').trim().slice(0, 1000);
  const communicationId = String(req.body?.communication_id || '').trim() || null;
  const messageContent = String(req.body?.message_content || '').trim().slice(0, 2000);
  const requestedChannel = String(req.body?.contact_channel || '').trim().toLowerCase();
  const allowedChannels = new Set(['whatsapp', 'phone', 'in_person', 'app', 'unknown']);
  const contactChannel = allowedChannels.has(requestedChannel) ? requestedChannel :
    outcome === 'message_sent' ? 'whatsapp' :
    outcome === 'met_in_person' ? 'in_person' : 'unknown';
  const option = OUTCOMES[outcome];
  if (!queueItemId || !option) {
    return res.status(400).json({ error: 'A queue item and valid follow-up outcome are required.' });
  }

  const client = await pool.connect();
  let event = null;
  let feedback = null;
  let personId = null;
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('nyeocare:daily-queue:'||$1,0))", [req.org.id]);

    const lookup = await client.query(
      `SELECT q.id queue_item_id,q.status queue_status,q.task_kind,q.source_id,q.payload queue_payload,
              a.id action_id,a.person_id,a.status action_status,a.action_metadata,a.outcome action_outcome,
              p.display_name,p.first_name,p.last_name
       FROM aria_daily_queue_items q
       JOIN aria_actions a ON a.id::text=q.source_id AND a.organization_id=q.organization_id
       JOIN people p ON p.id=a.person_id AND p.organization_id=a.organization_id
       WHERE q.id=$1 AND q.organization_id=$2 AND q.assigned_user_id=$3 AND q.task_kind='follow_up'
       FOR UPDATE OF q,a`,
      [queueItemId, req.org.id, req.user.id]
    );
    const row = lookup.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'This follow-up is no longer assigned to you.' });
    }
    if (row.queue_status === 'completed' && row.action_status === 'executed') {
      const saved = row.queue_payload?.follow_up_outcome || row.action_outcome || {};
      const savedResult = saved.result || saved.outcome || null;
      await client.query('ROLLBACK');
      if (savedResult === outcome) {
        return res.status(200).json({ success: true, completed: true, already_completed: true, outcome, first_visit_required: saved.required_first_visit_follow_up === true, feedback_id: saved.feedback_id || null, communication_id: saved.communication_id || null });
      }
      return res.status(409).json({ error: 'This follow-up already has a recorded outcome. Refresh ARIA Today before making another change.', completed: true, recorded_outcome: savedResult });
    }
    if (!['pending', 'deferred'].includes(row.queue_status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This follow-up is no longer open. Refresh ARIA Today to see its current status.' });
    }
    const firstVisitRequired = row.action_metadata?.first_visit_required === true;
    const routineKinds = new Set([
      'care_first_check_in',
      'attendance_absence_check_in',
      'returned_after_absence',
      'first_session_check_in'
    ]);
    const firstVisitOutcomes = new Set([
      'met_in_person', 'message_sent', 'reached', 'no_response',
      'no_contact_details', 'already_connected', 'not_first_visit', 'do_not_contact'
    ]);
    const routineOutcomes = new Set([
      'met_in_person', 'message_sent', 'reached', 'no_response',
      'no_contact_details', 'already_connected', 'do_not_contact'
    ]);
    if (!['proposed', 'approved'].includes(row.action_status) ||
        (firstVisitRequired && row.action_metadata?.kind !== 'first_session_check_in') ||
        (!firstVisitRequired && !routineKinds.has(String(row.action_metadata?.kind || ''))) ||
        (firstVisitRequired ? !firstVisitOutcomes.has(outcome) : !routineOutcomes.has(outcome))) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This is not an open follow-up task that can be completed with that outcome.' });
    }
    if (outcome === 'message_sent' && !communicationId && !messageContent) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Confirm a saved draft or provide the message content to record that it was sent.' });
    }
    personId = row.person_id;
    const context = {
      source: firstVisitRequired ? 'required_first_visit_follow_up' : 'routine_follow_up_outcome',
      first_visit_required: firstVisitRequired,
      contact_channel: contactChannel,
      communication_id: communicationId,
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
      ) VALUES($1,$2,$3,'follow_up',$4,NULL,$5::jsonb,$6,$7,NOW(),'human_report','reported',1,NOW())`,
      [req.org.id, row.person_id, row.action_id, outcome, JSON.stringify(context), req.user.id, feedback.id]
    );

    let communication = null;
    if (outcome === 'message_sent') {
      if (communicationId) {
        const updated = await client.query(
          `UPDATE person_communications
           SET status='sent',occurred_at=NOW(),
               metadata=COALESCE(metadata,'{}'::jsonb)||$1::jsonb,updated_at=NOW()
           WHERE id=$2 AND organization_id=$3 AND person_id=$4
             AND direction='outbound' AND status='draft'
             AND metadata->>'action_id'=$5
           RETURNING id,channel,status,occurred_at`,
          [JSON.stringify({
            follow_up_action_id: row.action_id,
            follow_up_outcome: outcome,
            confirmed_sent_by: req.user.id,
            source: context.source
          }), communicationId, req.org.id, row.person_id, row.action_id]
        );
        communication = updated.rows[0] || null;
        if (!communication) {
          throw Object.assign(new Error('The draft is no longer available to mark as sent. Refresh the follow-up before recording this outcome.'), { status: 409 });
        }
      } else {
        communication = (await client.query(
          `INSERT INTO person_communications(
            organization_id,person_id,channel,direction,status,subject,content,metadata,created_by,
            occurred_at,created_at,updated_at
          ) VALUES($1,$2,$3,'outbound','sent','Follow-up message',$4,$5::jsonb,$6,NOW(),NOW(),NOW())
          RETURNING id,channel,status,occurred_at`,
          [req.org.id, row.person_id, contactChannel, messageContent, JSON.stringify({
            action_id: row.action_id,
            follow_up_action_id: row.action_id,
            follow_up_outcome: outcome,
            confirmed_sent_by: req.user.id,
            source: context.source
          }), req.user.id]
        )).rows[0];
      }
    } else if (['met_in_person', 'reached', 'no_response', 'already_connected'].includes(outcome)) {
      communication = (await client.query(
        `INSERT INTO person_communications(
          organization_id,person_id,channel,direction,status,subject,content,metadata,created_by,
          occurred_at,created_at,updated_at
        ) VALUES($1,$2,$3,'outbound',$4,'Care follow-up',NULL,$5::jsonb,$6,NOW(),NOW(),NOW())
        RETURNING id,channel,status,occurred_at`,
        [req.org.id, row.person_id, contactChannel, outcome === 'no_response' ? 'sent' : 'completed',
          JSON.stringify({
            follow_up_action_id: row.action_id,
            follow_up_outcome: outcome,
            contact_attempt_recorded_by: req.user.id,
            source: context.source
          }), req.user.id]
      )).rows[0];
    }

    if (communication?.id) {
      context.communication_id = communication.id;
      await client.query(
        `UPDATE care_feedback SET context=$1::jsonb,updated_at=NOW()
         WHERE id=$2 AND organization_id=$3`,
        [JSON.stringify(context), feedback.id, req.org.id]
      );
      await client.query(
        `UPDATE intelligence_outcomes SET evidence=$1::jsonb
         WHERE feedback_id=$2 AND organization_id=$3`,
        [JSON.stringify(context), feedback.id, req.org.id]
      );
    }

    if (outcome !== 'message_sent' && communicationId) {
      // If a different outcome resolved the task, preserve the unused draft as cancelled history.
      await client.query(
        `UPDATE person_communications
         SET status='cancelled',
             metadata=COALESCE(metadata,'{}'::jsonb)||$1::jsonb,
             updated_at=NOW()
         WHERE id=$2 AND organization_id=$3 AND person_id=$4
           AND direction='outbound' AND status='draft'
           AND metadata->>'action_id'=$5`,
        [JSON.stringify({
          follow_up_draft_cancelled: true,
          cancellation_reason: outcome,
          cancelled_by: req.user.id
        }), communicationId, req.org.id, row.person_id, row.action_id]
      );
    }

    await client.query(
      `INSERT INTO timeline_events(people_id,event_type,title,description,metadata,source,occurred_at,created_at)
       VALUES($1,$2,$3,$4,$5::jsonb,'human',NOW(),NOW())`,
      [row.person_id, firstVisitRequired ? 'first_visit_follow_up' : 'follow_up_outcome', firstVisitRequired ? 'First-visit follow-up' : 'Follow-up outcome', option.label + (note ? ': ' + note : ''), JSON.stringify(context)]
    );

    if (outcome === 'do_not_contact') {
      await client.query(
        `INSERT INTO aria_care_contexts(
          organization_id,person_id,kind,starts_on,ends_on,service_type,note,metadata,created_by
        ) VALUES($1,$2,'other',CURRENT_DATE,NULL,NULL,$3,$4::jsonb,$5)`,
        [req.org.id, row.person_id, 'Person asked the organization not to initiate further contact.', JSON.stringify({
          do_not_contact: true,
          source: context.source,
          source_action_id: row.action_id,
          human_reported: true
        }), req.user.id]
      );
    }

    const storedOutcome = {
      required_first_visit_follow_up: firstVisitRequired,
      follow_up_completed: true,
      result: outcome,
      label: option.label,
      note,
      feedback_id: feedback.id,
      communication_id: communication?.id || null,
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
      [JSON.stringify({ follow_up_outcome: storedOutcome }), queueItemId, req.org.id, req.user.id]
    );

    if (outcome === 'do_not_contact') {
      // An explicit no-contact preference must also close other pending proactive messages.
      await client.query(
        `UPDATE aria_actions
         SET status='cancelled',
             failure_reason='Person asked not to be contacted; proactive message cancelled.',
             updated_at=NOW()
         WHERE organization_id=$1 AND person_id=$2 AND id<>$3
           AND type='SEND_MESSAGE' AND status IN('proposed','approved')`,
        [req.org.id, row.person_id, row.action_id]
      );
    }

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
      eventKey: (firstVisitRequired ? 'first-visit-follow-up:' : 'follow-up-outcome:') + row.action_id
    }, client);

    await client.query('COMMIT');

    // A failed background learning refresh must not undo the operator's recorded outcome.
    if (event) {
      try { await processAriaEvent(event); } catch (error) {
        console.error('[ARIA] Follow-up event processing failed:', error?.message || error);
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
      console.error('[ARIA] Follow-up learning failed:', error?.message || error);
    }

    return res.status(200).json({ success: true, completed: true, outcome, first_visit_required: firstVisitRequired, feedback_id: feedback.id, communication_id: communication?.id || communicationId || null });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[ARIA] Follow-up completion error:', error?.message || error);
    const status = Number(error?.status) || 500;
    return res.status(status).json({ error: status < 500 ? String(error.message || 'Invalid follow-up outcome.') : 'ARIA could not save this outcome safely. The follow-up remains open.' });
  } finally {
    client.release();
  }
});
