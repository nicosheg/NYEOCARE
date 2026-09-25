import pool from'../db';
import{clampConfidence,evidence}from'./epistemic';

const text=(v,max=1000)=>String(v??'').trim().slice(0,max);

async function build({organizationId,personId,client=null}){
 const db=client||pool;
 const[person,participation,observations,feedback,memory,actions]=await Promise.all([
  db.query("SELECT id,display_name,first_name,last_name,type,source,metadata,living_truth,identity_verification_status,identity_verified_at FROM people WHERE id=$1 AND organization_id=$2 AND COALESCE(status,'active')='active' LIMIT 1",[personId,organizationId]),
  db.query("SELECT id,participation_type,value,occurred_at FROM participation_records WHERE organization_id=$1 AND person_id=$2 ORDER BY occurred_at DESC LIMIT 12",[organizationId,personId]),
  db.query("SELECT id,type,status,confidence,severity,urgency,evidence,metadata,detected_at,expires_at FROM aria_observations WHERE organization_id=$1 AND person_id=$2 AND status='active' AND(expires_at IS NULL OR expires_at>NOW()) ORDER BY attention_score DESC,detected_at DESC LIMIT 20",[organizationId,personId]),
  db.query("SELECT id,feedback_type,sentiment,note,observed_at FROM care_feedback WHERE organization_id=$1 AND person_id=$2 ORDER BY observed_at DESC LIMIT 8",[organizationId,personId]),
  db.query("SELECT id,memory_type,memory_key,content,importance,confidence,source,source_event_id,evidence_kind,verification_status,valid_from,valid_until,created_by,actor_role,verified_at,metadata,updated_at FROM person_memory WHERE organization_id=$1 AND person_id=$2 AND active=true AND is_current=true AND(valid_until IS NULL OR valid_until>NOW()) ORDER BY CASE importance WHEN'permanent'then 4 WHEN'important'then 3 WHEN'temporary'then 2 ELSE 1 END DESC,confidence DESC,updated_at DESC LIMIT 20",[organizationId,personId]),
  db.query("SELECT id,type,status,priority,action_metadata,proposed_at,approved_at,executed_at,updated_at FROM aria_actions WHERE organization_id=$1 AND person_id=$2 ORDER BY updated_at DESC LIMIT 12",[organizationId,personId])
 ]);
 if(!person.rows.length)return null;
 const p=person.rows[0],identityStatus=String(p.identity_verification_status||'unverified'),storedTruth=p.living_truth&&typeof p.living_truth==='object'?p.living_truth:{},storedStatus=String(storedTruth.status||''),identityTrusted=identityStatus==='verified'||['manual','human_review'].includes(String(p.source||''))||p.metadata?.identity_verified===true;
 const claims=[{key:'identity.status',value:identityStatus,status:identityStatus==='conflict'||storedStatus==='conflict'?'conflicted':identityTrusted?'verified':storedStatus==='alive'?'observed':'unknown',source:'people.identity_verification',source_id:p.id,occurred_at:p.identity_verified_at||storedTruth.updated_at||null,confidence:identityTrusted?1:storedStatus==='alive'?.9:.7}];
 const latestParticipation=participation.rows[0];
 if(latestParticipation)claims.push({key:'participation.last_confirmed',value:latestParticipation.occurred_at,status:'verified',source:'participation_records',source_id:latestParticipation.id,occurred_at:latestParticipation.occurred_at,confidence:1});
 const conflicts=identityStatus==='conflict'||storedStatus==='conflict'?[{key:'identity.status',values:[{value:identityStatus,status:'conflicted',source:'people.identity_verification',occurred_at:p.identity_verified_at||storedTruth.updated_at||null}]}]:[];
 const unknowns=[];
 if(!latestParticipation)unknowns.push(evidence({kind:'uncertainty',status:'unknown',source:'participation_records',statement:'No confirmed participation is recorded for this person yet.',confidence:1}));
 const facts=participation.rows.map(pr=>evidence({kind:'fact',status:'verified',source:'participation_records',sourceId:pr.id,statement:'Confirmed '+(pr.participation_type||'participation')+' recorded.',occurredAt:pr.occurred_at,confidence:1}));
 const activeObservations=observations.rows.map(o=>evidence({kind:'observation',status:'observed',source:'aria_observation',sourceId:o.id,statement:text(o.evidence?.summary||o.metadata?.summary||o.type,600),occurredAt:o.detected_at,confidence:clampConfidence(o.confidence,.6),metadata:{type:o.type,severity:o.severity,urgency:o.urgency}}));
 const humanReports=feedback.rows.map(f=>evidence({kind:'human_report',status:'reported',source:'care_feedback',sourceId:f.id,statement:text(f.note||('Human feedback: '+f.feedback_type),600),occurredAt:f.observed_at,confidence:.8}));
 const memories=memory.rows.map(m=>evidence({kind:'human_report',status:'reported',source:m.source||'person_memory',sourceId:m.id,statement:text(m.content,800),occurredAt:m.updated_at,confidence:clampConfidence(m.confidence,.7),metadata:{memory_type:m.memory_type,importance:m.importance}}));
 const overallStatus=conflicts.length?'conflict':identityTrusted?'alive':storedStatus==='alive'?'alive':storedStatus==='needs_decision'?'needs_decision':'needs_decision';
 return{version:3,status:overallStatus,person:{id:p.id,name:p.display_name||[p.first_name,p.last_name].filter(Boolean).join(' '),type:p.type||null,source:p.source||null},claims,facts,observations:activeObservations,human_reports:humanReports,memories,unknowns,conflicts,recent_actions:actions.rows,generated_at:new Date().toISOString()};
}

export async function getLivingTruth({organizationId,personId}={}){
 if(!organizationId||!personId)throw new Error('organizationId and personId are required');
 return build({organizationId,personId});
}

export async function refreshLivingTruth({organizationId,personId}={},client=null){
 if(!organizationId||!personId)throw new Error('organizationId and personId are required');
 const db=client||pool;
 const truth=await build({organizationId,personId,client:db});
 if(!truth)return null;
 await db.query("UPDATE people SET living_truth=$3::jsonb,updated_at=NOW() WHERE id=$1 AND organization_id=$2",[personId,organizationId,JSON.stringify(truth)]);
 return truth;
}
