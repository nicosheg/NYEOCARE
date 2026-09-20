// lib/aria/stateManager.js
import pool from'../db';

const level=n=>n>=80?'critical':n>=60?'high':n>=35?'medium':'low';

export async function updatePersonState(personId,orgId,client=null){
 if(!personId||!orgId)throw new Error('personId and orgId are required');
 const db=client||pool;
 const[i,m,o,a,r]=await Promise.all([
  db.query(`SELECT lifecycle_state,engagement_score,attention_score,attention_level,next_best_action,action_reason FROM people_intelligence WHERE organization_id=$1 AND person_id=$2 LIMIT 1`,[orgId,personId]),
  db.query(`SELECT last_meaningful_event FROM engagement_metrics WHERE organization_id=$1 AND person_id=$2 LIMIT 1`,[orgId,personId]),
  db.query(`SELECT COUNT(*)::int count,COALESCE(MAX(attention_score),0)::float max_attention FROM aria_observations WHERE organization_id=$1 AND person_id=$2 AND status='active' AND(expires_at IS NULL OR expires_at>NOW())`,[orgId,personId]),
  db.query(`SELECT COUNT(*)::int count FROM aria_actions WHERE organization_id=$1 AND person_id=$2 AND status IN('proposed','approved','executing')`,[orgId,personId]),
  db.query(`SELECT relationship_state FROM relationship_scores WHERE organization_id=$1 AND person_id=$2 LIMIT 1`,[orgId,personId])
 ]);
 const x=i.rows[0]||{},ob=o.rows[0]||{},attention=Math.max(Number(x.attention_score)||0,Number(ob.max_attention)||0);
 const careState=attention>=80?'urgent_action_required':attention>=60?'needs_human_review':attention>=35?'care_opportunity':'healthy';
 const relationship=r.rows[0]?.relationship_state||'known';
 const follow=x.next_best_action?'recommended':'none';
 await db.query(`INSERT INTO aria_person_state(person_id,organization_id,engagement_state,care_state,relationship_state,followup_state,attention_level,open_observation_count,open_action_count,last_meaningful_event,lifecycle_state,engagement_score,next_best_action,attention_reason,updated_at)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW()) ON CONFLICT(organization_id,person_id) DO UPDATE SET engagement_state=EXCLUDED.engagement_state,care_state=EXCLUDED.care_state,relationship_state=EXCLUDED.relationship_state,followup_state=EXCLUDED.followup_state,attention_level=EXCLUDED.attention_level,open_observation_count=EXCLUDED.open_observation_count,open_action_count=EXCLUDED.open_action_count,last_meaningful_event=EXCLUDED.last_meaningful_event,lifecycle_state=EXCLUDED.lifecycle_state,engagement_score=EXCLUDED.engagement_score,next_best_action=EXCLUDED.next_best_action,attention_reason=EXCLUDED.attention_reason,updated_at=NOW()`,[personId,orgId,x.lifecycle_state==='new'?'first_time':x.lifecycle_state,careState,relationship,follow,level(attention),Number(ob.count)||0,Number(a.rows[0]?.count)||0,m.rows[0]?.last_meaningful_event||null,x.lifecycle_state||'new',Number(x.engagement_score)||0,x.next_best_action||null,x.action_reason||null]);
 return{personId,organizationId:orgId,careState,relationshipState:relationship,followupState:follow,attentionLevel:level(attention)};
}
