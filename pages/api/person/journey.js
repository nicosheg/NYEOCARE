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
const personRows=await safe(`SELECT p.*,pi.lifecycle_state AS intelligence_lifecycle,pi.engagement_score,pi.attention_score,pi.attention_level,pi.next_best_action,pi.action_reason,em.participation_count,em.participation_rate,em.participation_streak,em.inactivity_streak,em.first_seen,em.last_seen,em.last_meaningful_event,rs.score AS relationship_score,rs.relationship_state,aps.engagement_state,aps.care_state,aps.followup_state,aps.open_observation_count,aps.open_action_count,aps.attention_reason FROM people p LEFT JOIN people_intelligence pi ON pi.organization_id=p.organization_id AND pi.person_id=p.id LEFT JOIN engagement_metrics em ON em.organization_id=p.organization_id AND em.person_id=p.id LEFT JOIN relationship_scores rs ON rs.organization_id=p.organization_id AND rs.person_id=p.id LEFT JOIN aria_person_state aps ON aps.organization_id=p.organization_id AND aps.person_id=p.id WHERE p.organization_id=$1 AND p.id=$2 LIMIT 1`,[orgId,id]);
if(!personRows.length)return res.status(404).json({error:'Person not found'});
const q=[
['timeline',`SELECT * FROM timeline_events WHERE people_id=$1 ORDER BY COALESCE(occurred_at,created_at) DESC`,[id]],
['observations',`SELECT * FROM aria_observations WHERE organization_id=$1 AND person_id=$2 ORDER BY detected_at DESC`,[orgId,id]],
['actions',`SELECT * FROM aria_actions WHERE organization_id=$1 AND person_id=$2 ORDER BY created_at DESC`,[orgId,id]],
['memory',`SELECT * FROM person_memory WHERE organization_id=$1 AND person_id=$2 AND active=true ORDER BY CASE importance WHEN 'permanent' THEN 0 WHEN 'important' THEN 1 ELSE 2 END,updated_at DESC`,[orgId,id]],
['learning',`SELECT * FROM aria_learning WHERE organization_id=$1 AND person_id=$2 AND active=true ORDER BY updated_at DESC`,[orgId,id]],
['brain_feed',`SELECT * FROM aria_brain_feed WHERE organization_id=$1 AND person_id=$2 ORDER BY created_at DESC`,[orgId,id]],
['communications',`SELECT * FROM person_communications WHERE organization_id=$1 AND person_id=$2 ORDER BY occurred_at DESC,created_at DESC`,[orgId,id]],
['relationships',`SELECT r.*,p.first_name AS related_first_name,p.last_name AS related_last_name,p.display_name AS related_display_name FROM person_relationships r JOIN people p ON p.organization_id=r.organization_id AND p.id=r.related_person_id WHERE r.organization_id=$1 AND r.person_id=$2 AND r.active=true ORDER BY r.updated_at DESC`,[orgId,id]],
['groups',`SELECT g.name,g.group_type,m.role AS membership_role,m.status AS membership_status FROM organization_groups g JOIN person_memberships m ON m.organization_id=g.organization_id AND m.group_id=g.id WHERE g.organization_id=$1 AND m.person_id=$2 AND g.active=true ORDER BY g.group_type,g.name`,[orgId,id]],
['roles',`SELECT * FROM person_roles WHERE organization_id=$1 AND person_id=$2 ORDER BY status,role`,[orgId,id]],
['fields',`SELECT v.*,d.name AS field_name,d.key AS field_key,d.data_type FROM person_field_values v JOIN person_field_definitions d ON d.organization_id=v.organization_id AND d.id=v.field_id WHERE v.organization_id=$1 AND v.person_id=$2 AND d.active=true ORDER BY d.sort_order,d.name`,[orgId,id]],
['lifecycle',`SELECT l.*,s.name AS stage_name,s.stage_key,s.description AS stage_description FROM person_lifecycle l JOIN lifecycle_stages s ON s.organization_id=l.organization_id AND s.id=l.stage_id WHERE l.organization_id=$1 AND l.person_id=$2 ORDER BY l.started_at DESC`,[orgId,id]],
['tasks',`SELECT * FROM person_tasks WHERE organization_id=$1 AND person_id=$2 ORDER BY due_at NULLS LAST,created_at DESC`,[orgId,id]],
['documents',`SELECT * FROM person_documents WHERE organization_id=$1 AND person_id=$2 ORDER BY COALESCE(expires_at,issued_at) DESC NULLS LAST,created_at DESC`,[orgId,id]],
['aliases',`SELECT * FROM person_aliases WHERE organization_id=$1 AND person_id=$2 ORDER BY created_at DESC`,[orgId,id]],
['outcomes',`SELECT * FROM intelligence_outcomes WHERE organization_id=$1 AND person_id=$2 ORDER BY observed_at DESC,created_at DESC`,[orgId,id]],
['feedback',`SELECT * FROM care_feedback WHERE organization_id=$1 AND person_id=$2 ORDER BY observed_at DESC,created_at DESC`,[orgId,id]],
['aria_events',`SELECT * FROM aria_events WHERE organization_id=$1 AND person_id=$2 ORDER BY occurred_at DESC,created_at DESC`,[orgId,id]]
];
const values=await Promise.all(q.map(x=>safe(x[1],x[2]))),data={person:personRows[0]};q.forEach((x,i)=>data[x[0]]=values[i]);
const now=Date.now(),year=365*86400000,all=[...data.timeline.map(x=>({...x,_kind:'memory',_date:x.occurred_at||x.created_at})),...data.observations.map(x=>({...x,_kind:'observation',_date:x.detected_at||x.created_at})),...data.actions.map(x=>({...x,_kind:'action',_date:x.proposed_at||x.created_at})),...data.aria_events.map(x=>({...x,_kind:'aria event',_date:x.occurred_at||x.created_at}))];
data.temporal={past:all.filter(x=>new Date(x._date).getTime()<now-year),present:all.filter(x=>{const t=new Date(x._date).getTime();return t>=now-year&&t<=now}),future:all.filter(x=>new Date(x._date).getTime()>now)};
return res.status(200).json(data);
}catch(e){console.error('[PERSON JOURNEY] fatal',e);return res.status(500).json({error:'Unable to load this person right now'});}
}

export default withOrg(handler);
