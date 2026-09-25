// lib/aria/learningEngine.js
import pool from'../db';

const clamp=(n,min=0,max=1)=>Math.max(min,Math.min(max,Number.isFinite(Number(n))?Number(n):min));
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const validUntilFrom=context=>context?.valid_until||context?.expires_at||null;

export async function recordLearning({
 organizationId,personId=null,userId=null,learningType,learningKey,value={},confidence=.5,
 sourceType='human_feedback',sourceId=null,scopeLevel=null,scopeKey=null,
 learningDomain='personalized',learningContext='personalized',privacyClass='identity_private',
 evidenceKind='inference',verificationStatus='reported',validUntil=null,actorId=null
},client=null){
 if(!organizationId||!learningType||!learningKey)throw new Error('organizationId, learningType and learningKey are required');
 const level=scopeLevel||(userId?'personal':personId?'personal':'organization');
 const key=scopeKey||(userId?'user:'+userId:personId?'person:'+personId:'organization');
 const safeConfidence=clamp(confidence);
 const db=client||pool;
 const result=await db.query(
  `INSERT INTO aria_learning(
    organization_id,person_id,scope_key,learning_type,learning_key,value,confidence,source_type,source_id,active,
    learning_domain,scope_level,learning_context,privacy_class,evidence_kind,verification_status,valid_until,actor_id,created_at,updated_at
   )VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW())
   ON CONFLICT(organization_id,scope_key,learning_type,learning_key) DO UPDATE SET
    value=EXCLUDED.value,
    confidence=GREATEST(aria_learning.confidence,EXCLUDED.confidence),
    source_type=EXCLUDED.source_type,
    source_id=EXCLUDED.source_id,
    active=true,
    learning_domain=EXCLUDED.learning_domain,
    scope_level=EXCLUDED.scope_level,
    learning_context=EXCLUDED.learning_context,
    privacy_class=EXCLUDED.privacy_class,
    evidence_kind=EXCLUDED.evidence_kind,
    verification_status=EXCLUDED.verification_status,
    valid_until=EXCLUDED.valid_until,
    actor_id=EXCLUDED.actor_id,
    updated_at=NOW()
   RETURNING *`,
  [organizationId,personId,key,learningType,learningKey,obj(value),safeConfidence,sourceType,sourceId,learningDomain,level,learningContext,privacyClass,evidenceKind,verificationStatus,validUntil,actorId||userId||null]
 );
 return result.rows[0];
}

export async function recordGlobalLearning({learningType,learningKey,value={},confidence=.5,sourceType='human_review',sourceId=null},client=null){
 if(!learningType||!learningKey)throw new Error('learningType and learningKey are required');
 const db=client||pool;
 const result=await db.query(
  `INSERT INTO aria_global_learning(learning_type,learning_key,value,confidence,example_count,source_type,source_id,active,created_at,updated_at)
   VALUES($1,$2,$3,$4,1,$5,$6,true,NOW(),NOW())
   ON CONFLICT(learning_type,learning_key) DO UPDATE SET
    value=EXCLUDED.value,confidence=GREATEST(aria_global_learning.confidence,EXCLUDED.confidence),
    example_count=aria_global_learning.example_count+1,source_type=EXCLUDED.source_type,source_id=EXCLUDED.source_id,
    active=true,updated_at=NOW()
   RETURNING *`,
  [learningType,learningKey,obj(value),clamp(confidence),sourceType,sourceId]
 );
 return result.rows[0];
}

export async function learnFromFeedback({organizationId,personId,feedbackId,actionId,feedbackType,sentiment,context={},actorId=null},client=null){
 const positive=['positive','successful','helpful','worked','relationship_strengthened'].includes(feedbackType);
 const negative=['negative','unsuccessful','ineffective','did_not_work','wrong_approach','wrong_timing','timing_wrong'].includes(feedbackType);
 const confidence=(positive||negative)?.8:.5;
 const validUntil=validUntilFrom(context);
 await recordLearning({organizationId,personId,learningType:'care_response',learningKey:'latest_feedback',value:{feedback_type:feedbackType,sentiment,context,action_id:actionId},confidence,sourceType:'human_feedback',sourceId:feedbackId,evidenceKind:'human_report',verificationStatus:'reported',validUntil,actorId},client);
 await recordLearning({organizationId,personId:null,learningType:'organization_pattern',learningKey:'feedback:'+feedbackType,value:{feedback_type:feedbackType,sentiment,context,person_id:personId},confidence:.5,sourceType:'human_feedback',sourceId:feedbackId,scopeLevel:'organization',scopeKey:'organization',learningDomain:'personalized',learningContext:'care',privacyClass:'organization_private',evidenceKind:'inference',verificationStatus:'reported',validUntil,actorId},client);
 if(positive||negative)await recordLearning({organizationId,personId:null,learningType:'voice_signal',learningKey:positive?'positive_response':'negative_response',value:{feedback_type:feedbackType,sentiment},confidence:.6,sourceType:'human_feedback',sourceId:feedbackId,scopeLevel:'organization',scopeKey:'organization',learningDomain:'personalized',learningContext:'care',privacyClass:'organization_private',evidenceKind:'inference',verificationStatus:'reported',validUntil,actorId},client);
 if(actorId)await recordLearning({organizationId,userId:actorId,learningType:'care_operator_preference',learningKey:'feedback:'+feedbackType,value:{feedback_type:feedbackType,sentiment,context,last_person_id:personId,action_id:actionId},confidence:.6,sourceType:'human_feedback',sourceId:feedbackId,scopeLevel:'personal',scopeKey:'user:'+actorId,learningDomain:'personalized',learningContext:'care',privacyClass:'identity_private',evidenceKind:'human_report',verificationStatus:'reported',validUntil,actorId},client);
 return true;
}

export async function learnFromOutcome({organizationId,personId,actionId,outcome,outcomeScore,evidence={},sourceEventId=null,actorId=null},client=null){
 const score=outcomeScore===null||outcomeScore===undefined?null:Number(outcomeScore);
 const confidence=score===null?.5:.5+Math.abs(score-.5);
 return recordLearning({organizationId,personId:null,learningType:'action_outcome',learningKey:String(outcome),value:{action_id:actionId,person_id:personId,outcome,outcome_score:score,evidence},confidence:clamp(confidence),sourceType:'outcome',sourceId:sourceEventId||actionId,scopeLevel:'organization',scopeKey:'organization',learningDomain:'personalized',learningContext:'care',privacyClass:'organization_private',evidenceKind:'inference',verificationStatus:'observed',actorId},client);
}

export async function getLearnings(organizationId,{personId=null,userId=null,learningType=null,learningDomain=null,limit=50}={}){
 if(!organizationId)throw new Error('organizationId required');
 const safeLimit=Math.min(Math.max(Number(limit)||50,1),200),params=[organizationId];
 let where='organization_id=$1 AND active=true AND(valid_until IS NULL OR valid_until>NOW())';
 if(personId){params.push(personId);where+=' AND(person_id=$'+params.length+' OR person_id IS NULL)'}
 if(userId){params.push('user:'+userId);where+=' AND(scope_key=$'+params.length+' OR scope_level=\'organization\')'}
 if(learningType){params.push(learningType);where+=' AND learning_type=$'+params.length}
 if(learningDomain){params.push(learningDomain);where+=' AND learning_domain=$'+params.length}
 params.push(safeLimit);
 return(await pool.query('SELECT * FROM aria_learning WHERE '+where+' ORDER BY confidence DESC,updated_at DESC LIMIT $'+params.length,params)).rows;
}

export async function getGlobalLearnings({learningType=null,limit=40}={}){
 const safeLimit=Math.min(Math.max(Number(limit)||40,1),100),params=[],where=['active=true'];
 if(learningType){params.push(learningType);where.push('learning_type=$'+params.length)}
 params.push(safeLimit);
 return(await pool.query('SELECT learning_type,learning_key,value,confidence,example_count FROM aria_global_learning WHERE '+where.join(' AND ')+' ORDER BY confidence DESC,example_count DESC,updated_at DESC LIMIT $'+params.length,params)).rows;
}
