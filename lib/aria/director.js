// lib/aria/director.js
import{resolveIdentities}from'../identityResolver';

export async function handleScanEvent(extractedPeople,orgId,scanJobId,client){
 if(!client)throw new Error('Scan identity resolution requires an active database transaction');

 const decisions=await resolveIdentities(extractedPeople,orgId,scanJobId,client);
 const resolvedPeople=[];
 const needsReview=[];

 for(const decision of decisions){
  if(decision.status==='alive'&&decision.best_candidate_id){
   resolvedPeople.push({
    name:decision.extracted_name,
    phone:decision.extracted_phone,
    resolved_person_id:decision.best_candidate_id,
    status:'alive',
    confidence:decision.confidence
   });
  }

  if(decision.status==='conflict'||decision.status==='needs_decision'){
   const truth={
    status:decision.status,
    extracted_name:decision.extracted_name,
    extracted_phone:decision.extracted_phone,
    confidence:decision.confidence,
    candidate_ids:decision.candidate_ids,
    candidates:decision.candidates,
    best_candidate_id:decision.best_candidate_id,
    review_id:decision.review_id,
    source:'scan',
    updated_at:new Date().toISOString()
   };

   for(const candidateId of decision.candidate_ids){
    await client.query(
     `UPDATE people SET living_truth=$1,updated_at=NOW()
      WHERE id=$2 AND organization_id=$3`,
     [truth,candidateId,orgId]
    );
   }

   needsReview.push({...decision,resolved:false});
  }
 }

 return{decisions,resolvedPeople,needsReview};
}

export async function initializeCommunity(orgId){
 return{organizationId:orgId,initialized:true};
      }
