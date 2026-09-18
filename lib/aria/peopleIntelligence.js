// lib/aria/peopleIntelligence.js
import pool from'../db';

const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const level=n=>n>=80?'critical':n>=60?'high':n>=35?'medium':'low';

function actionFor({count,lifecycle,relationship,memories,feedback,change,learning}){
 if(count===0)return{action:'welcome_and_onboard',reason:'This person is newly known and deserves an intentional welcome.'};
 if(lifecycle==='onboarding')return{action:'continue_onboarding',reason:'This relationship is still forming.'};
 if(feedback<-.25)return{action:'adjust_care_approach',reason:'Recent human feedback suggests the previous care approach should change.'};
 if(change<-.45)return{action:'thoughtful_check_in',reason:'A meaningful change in the relationship deserves human understanding.'};
 if(learning==='negative_response')return{action:'adjust_care_approach',reason:'ARIA learned that a recent care approach did not land well.'};
 if(memories>0&&relationship>=60)return{action:'strengthen_relationship',reason:'There is meaningful relationship context that can help someone care personally.'};
 return{action:null,reason:null};
}

export async function updatePeopleIntelligence(personId,orgId,client=null){
 if(!personId||!orgId)throw new Error('personId and orgId are required');
 const db=client||pool;
 const[r,m,o,f,mem,learn]=await Promise.all([
  db.query(`SELECT id FROM people WHERE id=$1 AND organization_id=$2 AND status='active' LIMIT 1`,[personId,orgId]),
  db.query(`SELECT * FROM engagement_metrics WHERE organization_id=$1 AND person_id=$2 LIMIT 1`,[orgId,personId]),
  db.query(`SELECT COALESCE(MAX(attention_score),0)::float max_attention,COALESCE(MAX(CASE severity WHEN'critical'THEN 4 WHEN'high'THEN 3 WHEN'medium'THEN 2 ELSE 1 END),0)::int max_severity FROM aria_observations WHERE organization_id=$1 AND person_id=$2 AND status='active' AND(expires_at IS NULL OR expires_at>NOW())`,[orgId,personId]),
  db.query(`SELECT COUNT(*)::int total,COALESCE(SUM(CASE WHEN feedback_type IN('negative','ineffective','did_not_work','wrong_approach','wrong_timing','timing_wrong') THEN -1 ELSE 1 END),0)::float effect FROM care_feedback WHERE organization_id=$1 AND person_id=$2 AND observed_at>=NOW()-INTERVAL'180 days'`,[orgId,personId]),
  db.query(`SELECT COUNT(*)::int count FROM person_memory WHERE organization_id=$1 AND person_id=$2 AND active=true`,[orgId,personId]),
  db.query(`SELECT learning_key FROM aria_learning WHERE organization_id=$1 AND person_id=$2 AND learning_type='care_response' AND active=true ORDER BY confidence DESC,updated_at DESC LIMIT 1`,[orgId,personId])
 ]);
 if(!r.rows.length)throw new Error('Person not found');
 const x=m.rows[0]||{},obs=o.rows[0]||{},fb=f.rows[0]||{},memoryCount=Number(mem.rows[0]?.count)||0,learning=learn.rows[0]?.learning_key||null;
 const finite=(v,d=0)=>{const n=Number(v);return Number.isFinite(n)?n:d};
 const participation=Math.max(0,finite(x.participation_count));
 const relationship=Math.max(0,finite((await db.query(`SELECT score FROM relationship_scores WHERE organization_id=$1 AND person_id=$2 LIMIT 1`,[orgId,personId])).rows[0]?.score));
 const participationRate=Math.max(0,finite(x.participation_rate));
 const participationStreak=Math.max(0,finite(x.participation_streak));
 const change=finite(x.trend);
 const engagement=clamp(Math.round(45+participationRate*.3+participationStreak*4+relationship*.2),0,100);
 const observationSeverity=finite(obs.max_severity),observationAttention=finite(obs.max_attention),feedbackEffect=finite(fb.effect),attention=clamp(observationSeverity*15+observationAttention*.5+Math.max(0,-change)*20+Math.max(0,-feedbackEffect)*10,0,100);
 const lifecycle=participation===0?'new':participation===1?'onboarding':participation<4?'developing':'established';
 const feedback=Number(fb.total)?Number(fb.effect)/Number(fb.total):0;
 const a=actionFor({count:participation,lifecycle,relationship,memories:memoryCount,feedback,change,learning});
 const evidence={model:'care-v2',lifecycle_state:lifecycle,participation_count:participation,participation_rate:participationRate,participation_streak:participationStreak,trend:change,relationship_score:relationship,memory_count:memoryCount,active_observation_attention:finite(obs.max_attention),active_observation_severity:finite(obs.max_severity),human_feedback_count:Math.max(0,finite(fb.total)),learning_signal:learning};
 await db.query(`INSERT INTO people_intelligence(organization_id,person_id,lifecycle_state,engagement_score,attention_score,attention_level,next_best_action,action_reason,evidence,feature_snapshot,model_version,calculated_at,updated_at)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'care-v2',NOW(),NOW()) ON CONFLICT(organization_id,person_id) DO UPDATE SET lifecycle_state=EXCLUDED.lifecycle_state,engagement_score=EXCLUDED.engagement_score,attention_score=EXCLUDED.attention_score,attention_level=EXCLUDED.attention_level,next_best_action=EXCLUDED.next_best_action,action_reason=EXCLUDED.action_reason,evidence=EXCLUDED.evidence,feature_snapshot=EXCLUDED.feature_snapshot,model_version=EXCLUDED.model_version,calculated_at=NOW(),updated_at=NOW()`,[orgId,personId,lifecycle,engagement,attention,level(attention),a.action,a.reason,JSON.stringify(evidence),JSON.stringify(evidence)]);
 return{personId,organizationId:orgId,lifecycleState:lifecycle,engagementScore:engagement,relationshipScore:relationship,attentionScore:attention,attentionLevel:level(attention),nextBestAction:a.action,actionReason:a.reason,evidence};
                   }
