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
  }else if(decision.status==='conflict'||decision.status==='needs_decision'){
   needsReview.push({...decision,resolved:false});
  }
 }

 return{decisions,resolvedPeople,needsReview};
}

export async function initializeCommunity(orgId){
 return{organizationId:orgId,initialized:true};
}
