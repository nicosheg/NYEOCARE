// pages/api/review/duplicate-action.js
import pool from'../../../lib/db';
import{withAdmin}from'../../../lib/apiHelpers';
import{detectDuplicates}from'../../../lib/duplicateDetector';
async function person(db,id,org){const q=await db.query(`SELECT id,display_name,first_name,last_name,phone,phone_numbers,metadata,living_truth,identity_verification_status,identity_verified_at,identity_verified_by FROM people WHERE id=$1 AND organization_id=$2 AND status='active' FOR UPDATE`,[id,org]);return q.rows[0]||null}
function nameOf(p){return String(p.display_name||[p.first_name,p.last_name].filter(Boolean).join(' ')||p.first_name||'').trim()}
function phoneList(p){const v=Array.isArray(p.phone_numbers)?p.phone_numbers:p.phone?[p.phone]:[];return[...new Set(v.filter(Boolean).map(x=>typeof x==='string'?x:x?.normalized||x?.raw||x?.phone).filter(Boolean))]}
async function mergeAttendanceHistory(db,org,canonicalId,duplicateId){
 const collisions=(await db.query(`
  SELECT c.id canonical_id,d.id duplicate_id
  FROM attendance_records c
  JOIN attendance_records d ON d.organization_id=c.organization_id
  WHERE c.organization_id=$1 AND c.people_id=$2 AND d.people_id=$3
    AND (
      (c.session_id IS NOT NULL AND c.session_id=d.session_id)
      OR (c.session_id IS NULL AND d.session_id IS NULL AND c.attendance_date=d.attendance_date)
    )
  FOR UPDATE OF c,d
 `,[org,canonicalId,duplicateId])).rows;
 for(const row of collisions){
  await db.query(`
   UPDATE attendance_records c
   SET
     present=(COALESCE(c.present,false) OR COALESCE(d.present,false)),
     status=CASE WHEN COALESCE(c.present,false) OR COALESCE(d.present,false) THEN 'present' ELSE COALESCE(c.status,d.status) END,
     confirmed=(COALESCE(c.confirmed,false) OR COALESCE(d.confirmed,false)),
     attendance_date=COALESCE(c.attendance_date,d.attendance_date),
     session_section_id=COALESCE(c.session_section_id,d.session_section_id),
     group_id=COALESCE(c.group_id,d.group_id),
     source_sheet_id=COALESCE(c.source_sheet_id,d.source_sheet_id),
     marked_by=CASE WHEN d.marked_at IS NOT NULL AND (c.marked_at IS NULL OR d.marked_at>c.marked_at) THEN d.marked_by ELSE c.marked_by END,
     marked_at=CASE WHEN d.marked_at IS NOT NULL AND (c.marked_at IS NULL OR d.marked_at>c.marked_at) THEN d.marked_at ELSE c.marked_at END,
     reviewed_by=CASE WHEN d.reviewed_at IS NOT NULL AND (c.reviewed_at IS NULL OR d.reviewed_at>c.reviewed_at) THEN d.reviewed_by ELSE c.reviewed_by END,
     reviewed_at=CASE WHEN d.reviewed_at IS NOT NULL AND (c.reviewed_at IS NULL OR d.reviewed_at>c.reviewed_at) THEN d.reviewed_at ELSE c.reviewed_at END
   FROM attendance_records d
   WHERE c.id=$1 AND d.id=$2
  `,[row.canonical_id,row.duplicate_id]);
  await db.query('DELETE FROM attendance_records WHERE id=$1',[row.duplicate_id]);
 }
 await db.query(`UPDATE attendance_records SET people_id=$1 WHERE organization_id=$3 AND people_id=$2`,[canonicalId,duplicateId,org]);
}

async function mergeParticipationHistory(db,org,canonicalId,duplicateId){
 const collisions=(await db.query(`
  SELECT c.id canonical_id,d.id duplicate_id
  FROM participation_records c
  JOIN participation_records d
    ON d.organization_id=c.organization_id
   AND d.session_id=c.session_id
   AND d.participation_type=c.participation_type
  WHERE c.organization_id=$1 AND c.person_id=$2 AND d.person_id=$3 AND c.participation_type='attendance'
  FOR UPDATE OF c,d
 `,[org,canonicalId,duplicateId])).rows;
 for(const row of collisions){
  await db.query(`
   UPDATE participation_records c
   SET
     value=CASE
       WHEN jsonb_typeof(c.value)='object' AND jsonb_typeof(d.value)='object' THEN COALESCE(c.value,'{}'::jsonb)||COALESCE(d.value,'{}'::jsonb)
       ELSE COALESCE(c.value,d.value)
     END,
     occurred_at=CASE WHEN d.occurred_at>c.occurred_at THEN d.occurred_at ELSE c.occurred_at END
   FROM participation_records d
   WHERE c.id=$1 AND d.id=$2
  `,[row.canonical_id,row.duplicate_id]);
  await db.query('DELETE FROM participation_records WHERE id=$1',[row.duplicate_id]);
 }
 await db.query('UPDATE participation_records SET person_id=$1 WHERE organization_id=$3 AND person_id=$2',[canonicalId,duplicateId,org]);
}

async function mergeCurrentMemory(db,org,canonicalId,duplicateId){
 const collisions=(await db.query(`
  SELECT c.id canonical_id,d.id duplicate_id
  FROM person_memory c
  JOIN person_memory d
    ON d.organization_id=c.organization_id
   AND d.memory_type=c.memory_type
   AND d.memory_key IS NOT DISTINCT FROM c.memory_key
  WHERE c.organization_id=$1 AND c.person_id=$2 AND d.person_id=$3 AND c.is_current=true AND d.is_current=true
  FOR UPDATE OF c,d
 `,[org,canonicalId,duplicateId])).rows;
 for(const row of collisions){
  await db.query(`
   UPDATE person_memory c
   SET
     content=COALESCE(NULLIF(c.content,''),d.content),
     confidence=GREATEST(COALESCE(c.confidence,0),COALESCE(d.confidence,0)),
     metadata=CASE WHEN jsonb_typeof(c.metadata)='object' AND jsonb_typeof(d.metadata)='object' THEN COALESCE(c.metadata,'{}'::jsonb)||COALESCE(d.metadata,'{}'::jsonb) ELSE COALESCE(c.metadata,d.metadata) END,
     verification_status=CASE WHEN c.verification_status='verified' OR d.verification_status='verified' THEN 'verified' ELSE c.verification_status END
   FROM person_memory d
   WHERE c.id=$1 AND d.id=$2
  `,[row.canonical_id,row.duplicate_id]);
  await db.query('DELETE FROM person_memory WHERE id=$1',[row.duplicate_id]);
 }
 await db.query('UPDATE person_memory SET person_id=$1 WHERE organization_id=$3 AND person_id=$2',[canonicalId,duplicateId,org]);
}

async function mergeLearningHistory(db,org,canonicalId,duplicateId){
 const collisions=(await db.query(`
  SELECT c.id canonical_id,d.id duplicate_id
  FROM aria_learning c
  JOIN aria_learning d
    ON d.organization_id=c.organization_id
   AND d.scope_key=c.scope_key
   AND d.learning_type=c.learning_type
   AND d.learning_key=c.learning_key
  WHERE c.organization_id=$1 AND c.person_id=$2 AND d.person_id=$3
  FOR UPDATE OF c,d
 `,[org,canonicalId,duplicateId])).rows;
 for(const row of collisions){
  await db.query(`
   UPDATE aria_learning c
   SET
     confidence=GREATEST(COALESCE(c.confidence,0),COALESCE(d.confidence,0)),
     active=(COALESCE(c.active,false) OR COALESCE(d.active,false)),
     updated_at=GREATEST(c.updated_at,d.updated_at),
     value=CASE
       WHEN c.updated_at>=d.updated_at THEN c.value
       ELSE d.value
     END,
     source_id=CASE
       WHEN d.updated_at>c.updated_at THEN d.source_id
       ELSE c.source_id
     END
   FROM aria_learning d
   WHERE c.id=$1 AND d.id=$2
  `,[row.canonical_id,row.duplicate_id]);
  await db.query('DELETE FROM aria_learning WHERE id=$1',[row.duplicate_id]);
 }
 await db.query('UPDATE aria_learning SET person_id=$1 WHERE organization_id=$3 AND person_id=$2',[canonicalId,duplicateId,org]);
}

async function mergeActionHistory(db,org,canonicalId,duplicateId){
 const collisions=(await db.query(`
  SELECT c.id canonical_id,d.id duplicate_id
  FROM aria_actions c
  JOIN aria_actions d
    ON d.organization_id=c.organization_id
   AND d.action_key=c.action_key
  WHERE c.organization_id=$1 AND c.person_id=$2 AND d.person_id=$3
  FOR UPDATE OF c,d
 `,[org,canonicalId,duplicateId])).rows;
 for(const row of collisions){
  await db.query(`
   UPDATE aria_actions c
   SET
     status=CASE WHEN COALESCE(d.updated_at,d.proposed_at,d.created_at) > COALESCE(c.updated_at,c.proposed_at,c.created_at) THEN d.status ELSE c.status END,
     priority=GREATEST(COALESCE(c.priority,0),COALESCE(d.priority,0)),
     proposed_at=LEAST(COALESCE(c.proposed_at,d.proposed_at),COALESCE(d.proposed_at,c.proposed_at)),
     approved_by=COALESCE(c.approved_by,d.approved_by),
     approved_at=GREATEST(c.approved_at,d.approved_at),
     executed_at=GREATEST(c.executed_at,d.executed_at),
     outcome=CASE WHEN COALESCE(d.updated_at,d.proposed_at,d.created_at)>COALESCE(c.updated_at,c.proposed_at,c.created_at) THEN d.outcome ELSE c.outcome END,
     failure_reason=CASE WHEN COALESCE(d.updated_at,d.proposed_at,d.created_at)>COALESCE(c.updated_at,c.proposed_at,c.created_at) THEN d.failure_reason ELSE c.failure_reason END,
     expires_at=GREATEST(c.expires_at,d.expires_at),
     action_metadata=CASE WHEN jsonb_typeof(c.action_metadata)='object' AND jsonb_typeof(d.action_metadata)='object' THEN COALESCE(c.action_metadata,'{}'::jsonb)||COALESCE(d.action_metadata,'{}'::jsonb) ELSE COALESCE(c.action_metadata,d.action_metadata) END,
     updated_at=GREATEST(c.updated_at,d.updated_at)
   FROM aria_actions d
   WHERE c.id=$1 AND d.id=$2
  `,[row.canonical_id,row.duplicate_id]);
  await db.query('DELETE FROM aria_actions WHERE id=$1',[row.duplicate_id]);
 }
 await db.query('UPDATE aria_actions SET person_id=$1 WHERE organization_id=$3 AND person_id=$2',[canonicalId,duplicateId,org]);
}

async function mergeEventHistory(db,org,canonicalId,duplicateId){
 const collisions=(await db.query(`
  SELECT c.id canonical_id,d.id duplicate_id
  FROM aria_events c
  JOIN aria_events d
    ON d.organization_id=c.organization_id
   AND d.event_key=c.event_key
  WHERE c.organization_id=$1 AND c.person_id=$2 AND d.person_id=$3
  FOR UPDATE OF c,d
 `,[org,canonicalId,duplicateId])).rows;
 for(const row of collisions){
  await db.query(`
   UPDATE aria_events c
   SET
     metadata=CASE WHEN jsonb_typeof(c.metadata)='object' AND jsonb_typeof(d.metadata)='object' THEN COALESCE(c.metadata,'{}'::jsonb)||COALESCE(d.metadata,'{}'::jsonb) ELSE COALESCE(c.metadata,d.metadata) END,
     occurred_at=LEAST(c.occurred_at,d.occurred_at),
     processed_at=GREATEST(c.processed_at,d.processed_at),
     processing_status=CASE
       WHEN c.processing_status='processed' OR d.processing_status='processed' THEN 'processed'
       WHEN c.processing_status='failed' OR d.processing_status='failed' THEN 'failed'
       ELSE COALESCE(c.processing_status,d.processing_status)
     END,
     processing_attempts=GREATEST(COALESCE(c.processing_attempts,0),COALESCE(d.processing_attempts,0)),
     verification_status=CASE WHEN c.verification_status='verified' OR d.verification_status='verified' THEN 'verified' ELSE COALESCE(c.verification_status,d.verification_status) END,
     confidence=GREATEST(COALESCE(c.confidence,0),COALESCE(d.confidence,0))
   FROM aria_events d
   WHERE c.id=$1 AND d.id=$2
  `,[row.canonical_id,row.duplicate_id]);
  await db.query('DELETE FROM aria_events WHERE id=$1',[row.duplicate_id]);
 }
 await db.query('UPDATE aria_events SET person_id=$1 WHERE organization_id=$3 AND person_id=$2',[canonicalId,duplicateId,org]);
}

async function mergeObservationHistory(db,org,canonicalId,duplicateId){
 const collisions=(await db.query(`
  SELECT c.id canonical_id,d.id duplicate_id
  FROM aria_observations c
  JOIN aria_observations d
    ON d.organization_id=c.organization_id
   AND COALESCE(d.metadata->>'source_event_id','')=COALESCE(c.metadata->>'source_event_id','')
   AND COALESCE(d.metadata->>'source_event_id','')<>''
  WHERE c.organization_id=$1 AND c.person_id=$2 AND d.person_id=$3
  FOR UPDATE OF c,d
 `,[org,canonicalId,duplicateId])).rows;
 for(const row of collisions){
  await db.query(`
   UPDATE aria_observations c
   SET
     confidence=GREATEST(COALESCE(c.confidence,0),COALESCE(d.confidence,0)),
     attention_score=GREATEST(COALESCE(c.attention_score,0),COALESCE(d.attention_score,0)),
     evidence=CASE WHEN jsonb_typeof(c.evidence)='object' AND jsonb_typeof(d.evidence)='object' THEN COALESCE(c.evidence,'{}'::jsonb)||COALESCE(d.evidence,'{}'::jsonb) ELSE COALESCE(c.evidence,d.evidence) END,
     metadata=CASE WHEN jsonb_typeof(c.metadata)='object' AND jsonb_typeof(d.metadata)='object' THEN COALESCE(c.metadata,'{}'::jsonb)||COALESCE(d.metadata,'{}'::jsonb) ELSE COALESCE(c.metadata,d.metadata) END,
     detected_at=LEAST(c.detected_at,d.detected_at),
     expires_at=GREATEST(c.expires_at,d.expires_at),
     resolved_at=GREATEST(c.resolved_at,d.resolved_at),
     updated_at=GREATEST(c.updated_at,d.updated_at)
   FROM aria_observations d
   WHERE c.id=$1 AND d.id=$2
  `,[row.canonical_id,row.duplicate_id]);
  await db.query('DELETE FROM aria_observations WHERE id=$1',[row.duplicate_id]);
 }
 await db.query('UPDATE aria_observations SET person_id=$1 WHERE organization_id=$3 AND person_id=$2',[canonicalId,duplicateId,org]);
}

async function mergePersonRelationships(db,org,canonicalId,duplicateId){
 const selfEdges=await db.query(`
  DELETE FROM person_relationships
  WHERE organization_id=$1
    AND ((person_id=$2 AND related_person_id=$3) OR (person_id=$3 AND related_person_id=$2))
 `,[org,canonicalId,duplicateId]);
 const rows=(await db.query(`
  SELECT id,person_id,related_person_id,relationship_type,is_current,active,confidence,evidence,created_at,updated_at
  FROM person_relationships
  WHERE organization_id=$1 AND (person_id=$2 OR related_person_id=$2)
  FOR UPDATE
 `,[org,duplicateId])).rows;
 for(const row of rows){
  const newPersonId=String(row.person_id)===String(duplicateId)?canonicalId:row.person_id;
  const newRelatedId=String(row.related_person_id)===String(duplicateId)?canonicalId:row.related_person_id;
  if(String(newPersonId)===String(newRelatedId)){await db.query('DELETE FROM person_relationships WHERE id=$1',[row.id]);continue}
  if(row.is_current){
   const existing=(await db.query(`
    SELECT id,confidence,evidence,updated_at
    FROM person_relationships
    WHERE organization_id=$1 AND person_id=$2 AND related_person_id=$3 AND relationship_type=$4 AND is_current=true AND id<>$5
    FOR UPDATE
   `,[org,newPersonId,newRelatedId,row.relationship_type,row.id])).rows[0];
   if(existing){
    await db.query(`
     UPDATE person_relationships
     SET confidence=GREATEST(COALESCE(confidence,0),COALESCE($2,0)),
         evidence=CASE WHEN jsonb_typeof(evidence)='object' AND jsonb_typeof($3::jsonb)='object' THEN COALESCE(evidence,'{}'::jsonb)||$3::jsonb ELSE COALESCE(evidence,$3::jsonb) END,
         updated_at=GREATEST(updated_at,$4)
     WHERE id=$1
    `,[existing.id,row.confidence,JSON.stringify(row.evidence||{}),row.updated_at]);
    await db.query('DELETE FROM person_relationships WHERE id=$1',[row.id]);
    continue;
   }
  }
  await db.query('UPDATE person_relationships SET person_id=$1,related_person_id=$2 WHERE id=$3',[newPersonId,newRelatedId,row.id]);
 }
}

async function removeUniquePersonCollisions(db,org,canonicalId,duplicateId){
 const pairs=[
  ['person_aliases','alias'],
  ['person_roles','role'],
  ['person_field_values','field_id'],
  ['person_segment_members','segment_id']
 ];
 for(const [table,key] of pairs){
  if(table==='person_aliases'){
   await db.query(`DELETE FROM ${table} d USING ${table} c WHERE d.organization_id=$1 AND c.organization_id=$1 AND d.person_id=$2 AND c.person_id=$3 AND lower(d.alias)=lower(c.alias)`,[org,duplicateId,canonicalId]);
  }else if(table==='person_roles'){
   await db.query(`DELETE FROM ${table} d USING ${table} c WHERE d.organization_id=$1 AND c.organization_id=$1 AND d.person_id=$2 AND c.person_id=$3 AND d.role=c.role AND d.status=c.status`,[org,duplicateId,canonicalId]);
  }else if(table==='person_field_values'){
   await db.query(`DELETE FROM ${table} d USING ${table} c WHERE d.organization_id=$1 AND c.organization_id=$1 AND d.person_id=$2 AND c.person_id=$3 AND d.field_id=c.field_id`,[org,duplicateId,canonicalId]);
  }else{
   await db.query(`DELETE FROM ${table} d USING ${table} c WHERE d.organization_id=$1 AND c.organization_id=$1 AND d.person_id=$2 AND c.person_id=$3 AND d.segment_id=c.segment_id`,[org,duplicateId,canonicalId]);
  }
 }
 await db.query(`DELETE FROM aria_brain_feed d USING aria_brain_feed c WHERE d.organization_id=$1 AND c.organization_id=$1 AND d.person_id=$2 AND c.person_id=$3 AND d.dedupe_key IS NOT DISTINCT FROM c.dedupe_key`,[org,duplicateId,canonicalId]);
}
async function mergePeople(db,org,canonicalId,duplicateId,actorId,evidence){
 if(canonicalId===duplicateId)throw Object.assign(new Error('A person cannot be merged with themselves.'),{statusCode:400});
 const canonical=await person(db,canonicalId,org),duplicate=await person(db,duplicateId,org);
 if(!canonical||!duplicate)throw Object.assign(new Error('Both active people must still exist.'),{statusCode:404});
 await db.query(`SELECT id FROM people WHERE organization_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE`,[org,[String(canonicalId),String(duplicateId)].sort()]);
 await mergeAttendanceHistory(db,org,canonicalId,duplicateId);
 await mergeParticipationHistory(db,org,canonicalId,duplicateId);
 await mergeCurrentMemory(db,org,canonicalId,duplicateId);
 await removeUniquePersonCollisions(db,org,canonicalId,duplicateId);
 await mergeLearningHistory(db,org,canonicalId,duplicateId);
 await mergeActionHistory(db,org,canonicalId,duplicateId);
 await mergeEventHistory(db,org,canonicalId,duplicateId);
 await mergeObservationHistory(db,org,canonicalId,duplicateId);
 await mergePersonRelationships(db,org,canonicalId,duplicateId);

 for(const spec of [
  ['timeline_events','people_id'],
  ['aria_conversations','person_id'],
  ['aria_care_contexts','person_id'],
  ['care_feedback','person_id'],
  ['intelligence_outcomes','person_id'],
  ['person_memberships','person_id'],
  ['person_lifecycle','person_id'],
  ['person_documents','person_id'],
  ['person_tasks','person_id'],
  ['person_communications','person_id'],
 ]) {
  const[i,col]=spec;
  await db.query(`UPDATE ${i} SET ${col}=$1 WHERE ${col}=$2`,[canonicalId,duplicateId]);
 }
 for(const [table,col] of [['relationship_scores','person_id'],['engagement_metrics','person_id'],['people_intelligence','person_id']]){
   await db.query(`DELETE FROM ${table} WHERE organization_id=$1 AND ${col}=$2 AND EXISTS(SELECT 1 FROM ${table} c WHERE c.organization_id=$1 AND c.${col}=$3)`,[org,duplicateId,canonicalId]);
   await db.query(`UPDATE ${table} SET ${col}=$1 WHERE organization_id=$2 AND ${col}=$3`,[canonicalId,org,duplicateId]);
 }
 try{
  await db.query(`DELETE FROM aria_person_state WHERE organization_id=$1 AND person_id=$2 AND EXISTS(SELECT 1 FROM aria_person_state x WHERE x.organization_id=$1 AND x.person_id=$3)`,[org,duplicateId,canonicalId]);
  await db.query(`UPDATE aria_person_state SET person_id=$1 WHERE organization_id=$2 AND person_id=$3`,[canonicalId,org,duplicateId]);
 }catch(err){
  throw Object.assign(new Error('ARIA history could not be safely combined. Nothing was changed.'),{statusCode:409,code:'IDENTITY_ARIA_CONFLICT'});
 }
 try{
  await db.query(`INSERT INTO person_aliases(organization_id,person_id,alias,created_by) SELECT $1,$2,$3,$4 WHERE $3<>'' AND NOT EXISTS(SELECT 1 FROM person_aliases WHERE organization_id=$1 AND person_id=$2 AND lower(alias)=lower($3))`,[org,canonicalId,nameOf(duplicate),actorId]);
 }catch(err){console.warn('[DUPLICATE] Alias preservation skipped:',err.message)}
 const mergedPhones=[...new Set([...phoneList(canonical),...phoneList(duplicate)])].slice(0,2),phoneJson=JSON.stringify(mergedPhones.map((p,i)=>({raw:p,normalized:p,source:'identity_merge',index:i+1})));
 const mergedMetadata={...(canonical.metadata||{}),identity_verified:true,last_identity_merge:{duplicate_id:duplicateId,merged_at:new Date().toISOString(),merged_by:actorId,evidence}};
 const truth={...(canonical.living_truth||{}),status:'alive',source:'human_review',confirmed_at:(canonical.identity_verified_at||new Date().toISOString()),confirmed_by:(canonical.identity_verified_by||actorId)};
 await db.query(`UPDATE people SET phone=$2,phone_numbers=$3,identity_verification_status='verified',identity_verified_at=COALESCE(identity_verified_at,NOW()),identity_verified_by=COALESCE(identity_verified_by,$4),identity_verification_source=COALESCE(identity_verification_source,'human_review'),metadata=$5,living_truth=$6,updated_at=NOW() WHERE id=$1 AND organization_id=$7`,[canonicalId,mergedPhones[0]||null,phoneJson,actorId,mergedMetadata,truth,org]);
 await db.query(`UPDATE people SET status='archived',quarantine_reason=NULL,living_truth=jsonb_build_object('status','archived','source','identity_merge','merged_into',$2::text,'merged_at',NOW(),'merged_by',$3::text),metadata=metadata||jsonb_build_object('identity_merged_into',$2::text,'identity_merged_at',NOW(),'identity_merged_by',$3::text),updated_at=NOW() WHERE id=$1 AND organization_id=$4`,[duplicateId,canonicalId,actorId,org]);
 await db.query(`INSERT INTO identity_pair_decisions(organization_id,person_a_id,person_b_id,decision,decided_by,evidence,updated_at) VALUES($1,$2,$3,'duplicate_merged',$4,$5,NOW()) ON CONFLICT(organization_id,LEAST(person_a_id,person_b_id),GREATEST(person_a_id,person_b_id)) DO UPDATE SET decision='duplicate_merged',decided_by=EXCLUDED.decided_by,evidence=EXCLUDED.evidence,updated_at=NOW()`,[org,canonicalId,duplicateId,actorId,evidence]);
 return{canonical,duplicate}
}
export default withAdmin(async function handler(req,res){if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});const{action,canonicalId,duplicateId}=req.body||{};if(!['merge','keep_separate'].includes(action)||!canonicalId||!duplicateId)return res.status(400).json({error:'Invalid duplicate decision.'});const db=await pool.connect();try{await db.query('BEGIN');const ids=[String(canonicalId),String(duplicateId)].sort();await db.query(`SELECT id FROM people WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND status='active' ORDER BY id FOR UPDATE`,[req.org.id,ids]);const audit=await detectDuplicates(req.org.id,{db});const pair=audit.duplicates.find(x=>[String(x.left.id),String(x.right.id)].includes(String(canonicalId))&&[String(x.left.id),String(x.right.id)].includes(String(duplicateId)));if(!pair){await db.query('ROLLBACK');return res.status(409).json({error:'This duplicate decision is no longer supported by current evidence.',code:'DUPLICATE_STALE'})}const evidence={score:pair.score,status:pair.status,evidence:pair.evidence,method:pair.method,detector_version:audit.detector_version};if(action==='keep_separate'){const a=await person(db,canonicalId,req.org.id),b=await person(db,duplicateId,req.org.id);const shared=[...new Set(phoneList(a).filter(x=>phoneList(b).includes(x)))];await db.query(`INSERT INTO identity_pair_decisions(organization_id,person_a_id,person_b_id,decision,decided_by,evidence,updated_at) VALUES($1,$2,$3,'keep_separate',$4,$5,NOW()) ON CONFLICT(organization_id,LEAST(person_a_id,person_b_id),GREATEST(person_a_id,person_b_id)) DO UPDATE SET decision='keep_separate',decided_by=EXCLUDED.decided_by,evidence=EXCLUDED.evidence,updated_at=NOW()`,[req.org.id,canonicalId,duplicateId,req.user.id,{...evidence,reason:'human_confirmed_separate'}]);for(const phone of shared)await db.query(`INSERT INTO identity_shared_contacts(organization_id,person_a_id,person_b_id,phone,confirmed_by,metadata) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(organization_id,LEAST(person_a_id,person_b_id),GREATEST(person_a_id,person_b_id),phone) DO UPDATE SET confirmed_by=EXCLUDED.confirmed_by,confirmed_at=NOW(),metadata=EXCLUDED.metadata`,[req.org.id,canonicalId,duplicateId,phone,req.user.id,{reason:'human_confirmed_shared_contact'}]);await db.query(`UPDATE people SET identity_verification_status='verified',identity_verified_at=COALESCE(identity_verified_at,NOW()),identity_verified_by=COALESCE(identity_verified_by,$2),identity_verification_source=COALESCE(identity_verification_source,'human_review'),metadata=metadata||jsonb_build_object('identity_verified',true) WHERE id=ANY($1::uuid[]) AND organization_id=$3`,[ids,req.user.id,req.org.id]);await db.query('COMMIT');return res.status(200).json({ok:true,action:'kept_separate',shared_phones:shared.length})}await mergePeople(db,req.org.id,canonicalId,duplicateId,req.user.id,evidence);await db.query('COMMIT');return res.status(200).json({ok:true,action:'merged',canonical_id:canonicalId,archived_id:duplicateId,verified:true})}catch(err){try{await db.query('ROLLBACK')}catch{}console.error('[DUPLICATE] Action error:',err);const status=err.statusCode||500;const error=status===409||status===404||status===400?err.message:'This identity decision could not be completed safely. Nothing was changed.';return res.status(status).json({error,code:err.code||'DUPLICATE_ACTION_FAILED'})}finally{db.release()}});
