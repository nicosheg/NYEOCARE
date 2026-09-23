// pages/api/person/journey.js
import pool from'../../../lib/db';
import{withOrg}from'../../../lib/apiHelpers';

const safe=async(sql,args=[])=>{try{return(await pool.query(sql,args)).rows}catch(e){console.error('[PERSON JOURNEY]',e.message);return[]}};

async function handler(req,res){
if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
const id=String(req.query.person_id||'');
if(!id)return res.status(400).json({error:'person_id is required'});
const orgId=req.org.id;
try{
const personRows=await safe(`SELECT p.*,pi.lifecycle_state AS intelligence_lifecycle,pi.engagement_score,pi.attention_score,pi.attention_level,pi.next_best_action,pi.action_reason,em.participation_count,em.participation_rate,em.participation_streak,em.inactivity_streak,em.first_seen,em.last_meaningful_event,
        COALESCE(
          em.last_seen,
          (SELECT MAX(pr.occurred_at) FROM participation_records pr WHERE pr.organization_id=p.organization_id AND pr.person_id=p.id AND pr.participation_type='attendance'),
          (SELECT MAX(ar.marked_at) FROM attendance_records ar WHERE ar.organization_id=p.organization_id AND ar.people_id=p.id AND ar.present=true AND ar.confirmed=true)
        ) AS last_seen,
        COALESCE(
          em.last_seen,
          (SELECT MAX(pr.occurred_at) FROM participation_records pr WHERE pr.organization_id=p.organization_id AND pr.person_id=p.id AND pr.participation_type='attendance'),
          (SELECT MAX(ar.marked_at) FROM attendance_records ar WHERE ar.organization_id=p.organization_id AND ar.people_id=p.id AND ar.present=true AND ar.confirmed=true)
        ) AS last_attendance_at,
        (SELECT MAX(z.at) FROM(
          SELECT MAX(pc.occurred_at) AS at
          FROM person_communications pc
          WHERE pc.organization_id=p.organization_id AND pc.person_id=p.id
            AND (
              (pc.direction='inbound' AND pc.status IN('received','completed','sent','delivered','read'))
              OR (pc.direction='outbound' AND pc.status IN('completed','sent','delivered','read'))
            )
          UNION ALL
          SELECT MAX(cf.observed_at) AS at
          FROM care_feedback cf
          WHERE cf.organization_id=p.organization_id AND cf.person_id=p.id
            AND COALESCE(cf.feedback_type,'')<>'no_response'
          UNION ALL
          SELECT MAX(te.occurred_at) AS at
          FROM timeline_events te
          WHERE te.people_id=p.id
            AND te.source IN('human','conversation_import')
            AND te.event_type NOT IN('identity_review','aria_draft','scan_review','note','person_archived')
        )z) AS last_interaction_at,rs.score AS relationship_score,rs.relationship_state,aps.engagement_state,aps.care_state,aps.followup_state,aps.open_observation_count,aps.open_action_count,aps.attention_reason FROM people p LEFT JOIN people_intelligence pi ON pi.organization_id=p.organization_id AND pi.person_id=p.id LEFT JOIN engagement_metrics em ON em.organization_id=p.organization_id AND em.person_id=p.id LEFT JOIN relationship_scores rs ON rs.organization_id=p.organization_id AND rs.person_id=p.id LEFT JOIN aria_person_state aps ON aps.organization_id=p.organization_id AND aps.person_id=p.id WHERE p.organization_id=$1 AND p.id=$2 LIMIT 1`,[orgId,id]);
if(!personRows.length)return res.status(404).json({error:'Person not found'});
const journey=(await pool.query(`
WITH person AS(
 SELECT p.*,pi.lifecycle_state AS intelligence_lifecycle,pi.engagement_score,pi.attention_score,pi.attention_level,pi.next_best_action,pi.action_reason,
        em.participation_count,em.participation_rate,em.participation_streak,em.inactivity_streak,em.first_seen,em.last_meaningful_event,
        COALESCE(
          em.last_seen,
          (SELECT MAX(pr.occurred_at) FROM participation_records pr WHERE pr.organization_id=p.organization_id AND pr.person_id=p.id AND pr.participation_type='attendance'),
          (SELECT MAX(ar.marked_at) FROM attendance_records ar WHERE ar.organization_id=p.organization_id AND ar.people_id=p.id AND ar.present=true AND ar.confirmed=true)
        ) AS last_seen,
        COALESCE(
          em.last_seen,
          (SELECT MAX(pr.occurred_at) FROM participation_records pr WHERE pr.organization_id=p.organization_id AND pr.person_id=p.id AND pr.participation_type='attendance'),
          (SELECT MAX(ar.marked_at) FROM attendance_records ar WHERE ar.organization_id=p.organization_id AND ar.people_id=p.id AND ar.present=true AND ar.confirmed=true)
        ) AS last_attendance_at,
        (SELECT MAX(z.at) FROM(
          SELECT MAX(pc.occurred_at) AS at
          FROM person_communications pc
          WHERE pc.organization_id=p.organization_id AND pc.person_id=p.id
            AND (
              (pc.direction='inbound' AND pc.status IN('received','completed','sent','delivered','read'))
              OR (pc.direction='outbound' AND pc.status IN('completed','sent','delivered','read'))
            )
          UNION ALL
          SELECT MAX(cf.observed_at) AS at
          FROM care_feedback cf
          WHERE cf.organization_id=p.organization_id AND cf.person_id=p.id
            AND COALESCE(cf.feedback_type,'')<>'no_response'
          UNION ALL
          SELECT MAX(te.occurred_at) AS at
          FROM timeline_events te
          WHERE te.people_id=p.id
            AND te.source IN('human','conversation_import')
            AND te.event_type NOT IN('identity_review','aria_draft','scan_review','note','person_archived')
        )z) AS last_interaction_at,
        rs.score AS relationship_score,rs.relationship_state,aps.engagement_state,aps.care_state,aps.followup_state,
        aps.open_observation_count,aps.open_action_count,aps.attention_reason
 FROM people p
 LEFT JOIN people_intelligence pi ON pi.organization_id=p.organization_id AND pi.person_id=p.id
 LEFT JOIN engagement_metrics em ON em.organization_id=p.organization_id AND em.person_id=p.id
 LEFT JOIN relationship_scores rs ON rs.organization_id=p.organization_id AND rs.person_id=p.id
 LEFT JOIN aria_person_state aps ON aps.organization_id=p.organization_id AND aps.person_id=p.id
 WHERE p.organization_id=$1 AND p.id=$2
 LIMIT 1
)
SELECT
 (SELECT row_to_json(person) FROM person) AS person,
 COALESCE((SELECT json_agg(x) FROM(
   SELECT * FROM timeline_events WHERE people_id=$2 ORDER BY COALESCE(occurred_at,created_at) DESC LIMIT 100
 )x),'[]'::json) AS timeline,
 COALESCE((SELECT json_agg(x) FROM(
   SELECT * FROM aria_observations WHERE organization_id=$1 AND person_id=$2 ORDER BY detected_at DESC LIMIT 50
 )x),'[]'::json) AS observations,
 COALESCE((SELECT json_agg(x) FROM(
   SELECT * FROM aria_actions WHERE organization_id=$1 AND person_id=$2 ORDER BY created_at DESC LIMIT 50
 )x),'[]'::json) AS actions,
 COALESCE((SELECT json_agg(x) FROM(
   SELECT * FROM person_memory WHERE organization_id=$1 AND person_id=$2 AND active=true
   ORDER BY CASE importance WHEN 'permanent' THEN 0 WHEN 'important' THEN 1 ELSE 2 END,updated_at DESC LIMIT 50
 )x),'[]'::json) AS memory,
 COALESCE((SELECT json_agg(x) FROM(
   SELECT * FROM aria_learning WHERE organization_id=$1 AND person_id=$2 AND active=true ORDER BY updated_at DESC LIMIT 50
 )x),'[]'::json) AS learning,
 COALESCE((SELECT json_agg(x) FROM(
   SELECT * FROM aria_brain_feed WHERE organization_id=$1 AND person_id=$2 ORDER BY created_at DESC LIMIT 50
 )x),'[]'::json) AS brain_feed,
 COALESCE((SELECT json_agg(x) FROM(
   SELECT * FROM person_communications WHERE organization_id=$1 AND person_id=$2 ORDER BY occurred_at DESC,created_at DESC LIMIT 50
 )x),'[]'::json) AS communications,
 COALESCE((SELECT json_agg(x) FROM(
   SELECT c.id,c.status,c.created_at,c.updated_at,
     COALESCE((SELECT json_agg(json_build_object('id',m.id,'role',m.role,'content',m.content,'metadata',m.metadata,'created_at',m.created_at) ORDER BY m.created_at)
               FROM aria_messages m WHERE m.conversation_id=c.id),'[]'::json) AS messages
   FROM aria_conversations c
   WHERE c.organization_id=$1 AND c.person_id=$2
   ORDER BY c.updated_at DESC LIMIT 20
 )x),'[]'::json) AS conversations,
 COALESCE((SELECT json_agg(x) FROM(
   SELECT r.*,p2.first_name AS related_first_name,p2.last_name AS related_last_name,p2.display_name AS related_display_name
   FROM person_relationships r
   JOIN people p2 ON p2.organization_id=r.organization_id AND p2.id=r.related_person_id
   WHERE r.organization_id=$1 AND r.person_id=$2 AND r.active=true
   ORDER BY r.updated_at DESC LIMIT 50
 )x),'[]'::json) AS relationships,
 COALESCE((SELECT json_agg(x) FROM(
   SELECT g.name,g.group_type,m.role AS membership_role,m.status AS membership_status
   FROM organization_groups g
   JOIN person_memberships m ON m.organization_id=g.organization_id AND m.group_id=g.id
   WHERE g.organization_id=$1 AND m.person_id=$2 AND g.active=true
   ORDER BY g.group_type,g.name LIMIT 50
 )x),'[]'::json) AS groups,
 COALESCE((SELECT json_agg(x) FROM(
   SELECT * FROM person_roles WHERE organization_id=$1 AND person_id=$2 ORDER BY status,role LIMIT 50
 )x),'[]'::json) AS roles,
 COALESCE((SELECT json_agg(x) FROM(
   SELECT v.*,d.name AS field_name,d.key AS field_key,d.data_type
   FROM person_field_values v
   JOIN person_field_definitions d ON d.organization_id=v.organization_id AND d.id=v.field_id
   WHERE v.organization_id=$1 AND v.person_id=$2 AND d.active=true
   ORDER BY d.sort_order,d.name LIMIT 50
 )x),'[]'::json) AS fields,
 COALESCE((SELECT json_agg(x) FROM(
   SELECT l.*,s.name AS stage_name,s.stage_key,s.description AS stage_description
   FROM person_lifecycle l
   JOIN lifecycle_stages s ON s.organization_id=l.organization_id AND s.id=l.stage_id
   WHERE l.organization_id=$1 AND l.person_id=$2
   ORDER BY l.started_at DESC LIMIT 50
 )x),'[]'::json) AS lifecycle,
 COALESCE((SELECT json_agg(x) FROM(
   SELECT * FROM person_tasks WHERE organization_id=$1 AND person_id=$2 ORDER BY due_at NULLS LAST,created_at DESC LIMIT 50
 )x),'[]'::json) AS tasks,
 COALESCE((SELECT json_agg(x) FROM(
   SELECT * FROM person_documents WHERE organization_id=$1 AND person_id=$2 ORDER BY COALESCE(expires_at,issued_at) DESC NULLS LAST,created_at DESC LIMIT 50
 )x),'[]'::json) AS documents,
 COALESCE((SELECT json_agg(x) FROM(
   SELECT * FROM person_aliases WHERE organization_id=$1 AND person_id=$2 ORDER BY created_at DESC LIMIT 50
 )x),'[]'::json) AS aliases,
 COALESCE((SELECT json_agg(x) FROM(
   SELECT * FROM intelligence_outcomes WHERE organization_id=$1 AND person_id=$2 ORDER BY observed_at DESC,created_at DESC LIMIT 50
 )x),'[]'::json) AS outcomes,
 COALESCE((SELECT json_agg(x) FROM(
   SELECT * FROM care_feedback WHERE organization_id=$1 AND person_id=$2 ORDER BY observed_at DESC,created_at DESC LIMIT 50
 )x),'[]'::json) AS feedback,
 COALESCE((SELECT json_agg(x) FROM(
   SELECT * FROM aria_events WHERE organization_id=$1 AND person_id=$2 ORDER BY occurred_at DESC,created_at DESC LIMIT 100
 )x),'[]'::json) AS aria_events
FROM person
`,[orgId,id])).rows[0];
if(!journey?.person)return res.status(404).json({error:'Person not found'});
const data={person:journey.person};
for(const key of ['timeline','observations','actions','memory','learning','brain_feed','communications','conversations','relationships','groups','roles','fields','lifecycle','tasks','documents','aliases','outcomes','feedback','aria_events'])data[key]=Array.isArray(journey[key])?journey[key]:[];
const now=Date.now(),year=365*86400000,all=[...data.timeline.map(x=>({...x,_kind:'memory',_date:x.occurred_at||x.created_at})),...data.observations.map(x=>({...x,_kind:'observation',_date:x.detected_at||x.created_at})),...data.actions.map(x=>({...x,_kind:'action',_date:x.proposed_at||x.created_at})),...data.aria_events.map(x=>({...x,_kind:'aria event',_date:x.occurred_at||x.created_at}))];
data.temporal={past:all.filter(x=>new Date(x._date).getTime()<now-year),present:all.filter(x=>{const t=new Date(x._date).getTime();return t>=now-year&&t<=now}),future:all.filter(x=>new Date(x._date).getTime()>now)};
return res.status(200).json(data);
}catch(e){console.error('[PERSON JOURNEY] fatal',e);return res.status(500).json({error:'Unable to load this person right now'});}
}

export default withOrg(handler);
