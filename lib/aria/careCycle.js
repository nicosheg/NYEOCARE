// lib/aria/careCycle.js
import pool from'../db';
import{updateEngagementMetricsForPerson}from'./engagementIntelligence';
import{computeRelationshipScore}from'./relationshipScore';
import{updatePeopleIntelligence}from'./peopleIntelligence';
import{updatePersonState}from'./stateManager';
import{generateCareRecommendations}from'./careEngine';import{planActionFromObservation}from'./recommendationEngine';

const MAX_PEOPLE=1000;
async function generateReturnDueActions(orgId){
 const result=await pool.query('SELECT c.id,c.person_id,c.expected_return_date,c.expected_service_type,p.first_name,p.last_name FROM aria_attendance_contexts c JOIN people p ON p.id=c.person_id AND p.organization_id=c.organization_id WHERE c.organization_id=$1 AND c.resolved_at IS NULL AND c.expected_return_known=true AND c.expected_return_date<=CURRENT_DATE AND p.status=\'active\'',[orgId]);
 let created=0;
 for(const row of result.rows){
  const name=[row.first_name,row.last_name].filter(Boolean).join(' ')||'This person';
  const action=await planActionFromObservation({organizationId:orgId,personId:row.person_id,actionType:'REQUEST_REVIEW',priority:'medium',actionMetadata:{kind:'expected_return_due',notify_organization:true,context_id:row.id,expected_return_date:row.expected_return_date,expected_service_type:row.expected_service_type,summary:'Today is a possible return day for '+name+'; they have not yet been recorded at this gathering.',knowledge:'A possible return time was supplied by a user; it is not a guarantee.',suggestion:'Review whether a gentle check-in is useful.'},actionKey:'attendance:return_due:'+row.id});
  if(action)created++;
 }
 return created;
}

export async function runCareCycle(orgId,{force=false}={}){
 if(!orgId)throw new Error('orgId required');
 const people=await pool.query(`SELECT id FROM people WHERE organization_id=$1 AND status='active' ORDER BY id LIMIT $2`,[orgId,MAX_PEOPLE]);
 const ids=people.rows.map(x=>x.id);
 if(!ids.length){let due=0;try{due=await generateReturnDueActions(orgId)}catch(e){failed=1;console.error('[ARIA] return-due',e.message)}return{organizationId:orgId,processed:0,failed,actions:due,ranAt:new Date().toISOString()};
 let failed=0;
 for(const id of ids){
  try{await updateEngagementMetricsForPerson(id,orgId)}catch(e){failed++;console.error('[ARIA] metrics',id,e.message)}
 }
 try{await computeRelationshipScore(orgId)}catch(e){failed++;console.error('[ARIA] relationship',e.message)}
 let processed=0;
 for(const id of ids){
  try{await updatePeopleIntelligence(id,orgId);await updatePersonState(id,orgId);processed++}catch(e){failed++;console.error('[ARIA] intelligence',id,e.message)}
 }
 let actions=[];
 try{actions=await generateCareRecommendations(orgId)}catch(e){failed++;console.error('[ARIA] care',e.message)}
 try{const due=await generateReturnDueActions(orgId);actions=actions.concat(Array.from({length:due},()=>({})));}catch(e){failed++;console.error('[ARIA] return-due',e.message)}
 if(failed&&!force)console.warn(`[ARIA] cycle completed with ${failed} failure(s)`);
 return{organizationId:orgId,processed,checked:ids.length,failed,actions:actions.length,ranAt:new Date().toISOString()};
   }
