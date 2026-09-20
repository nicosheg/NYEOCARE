// lib/aria/careCycle.js
import pool from'../db';
import{updateEngagementMetricsForPeople}from'./engagementIntelligence';
import{computeRelationshipScore}from'./relationshipScore';
import{updatePeopleIntelligence}from'./peopleIntelligence';
import{updatePersonState}from'./stateManager';
import{generateCareRecommendations}from'./careEngine';
import{planActionFromObservation}from'./recommendationEngine';

const MAX_PEOPLE=1000,CONCURRENCY=2;

async function mapConcurrent(items,limit,fn){
 if(!items.length)return[];
 const results=new Array(items.length);let cursor=0;
 async function worker(){while(true){const i=cursor++;if(i>=items.length)return;results[i]=await fn(items[i],i)}}
 await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));
 return results;
}

async function generateReturnDueActions(orgId){
 const result=await pool.query('SELECT c.id,c.person_id,c.expected_return_date,c.expected_service_type,p.first_name,p.last_name FROM aria_attendance_contexts c JOIN people p ON p.id=c.person_id AND p.organization_id=c.organization_id WHERE c.organization_id=$1 AND c.resolved_at IS NULL AND c.expected_return_known=true AND c.expected_return_date<=CURRENT_DATE AND p.status=\'active\'',[orgId]);
 const created=await mapConcurrent(result.rows,CONCURRENCY,async row=>{
  try{
   const name=[row.first_name,row.last_name].filter(Boolean).join(' ')||'This person';
   return await planActionFromObservation({organizationId:orgId,personId:row.person_id,actionType:'REQUEST_REVIEW',priority:'medium',actionMetadata:{kind:'expected_return_due',notify_organization:true,context_id:row.id,expected_return_date:row.expected_return_date,expected_service_type:row.expected_service_type,summary:'Today is a possible return day for '+name+'; they have not yet been recorded at this gathering.',knowledge:'A possible return time was supplied by a user; it is not a guarantee.',suggestion:'Review whether a gentle check-in is useful.'},actionKey:'attendance:return_due:'+row.id});
  }catch(e){console.error('[ARIA] return-due action',e.message);return null}
 });
 return created.filter(Boolean).length;
}

export async function runCareCycle(orgId,{force=false}={}){
 if(!orgId)throw new Error('orgId required');
 const started=Date.now(),people=await pool.query(`SELECT id FROM people WHERE organization_id=$1 AND status='active' ORDER BY id LIMIT $2`,[orgId,MAX_PEOPLE]);
 const ids=people.rows.map(x=>x.id);let failed=0;
 if(!ids.length){let due=0;try{due=await generateReturnDueActions(orgId)}catch(e){failed++;console.error('[ARIA] return-due',e.message)}return{organizationId:orgId,processed:0,failed,actions:due,ranAt:new Date().toISOString(),durationMs:Date.now()-started};}
 try{await updateEngagementMetricsForPeople(ids,orgId)}catch(e){failed++;console.error('[ARIA] metrics',e.message)}
 try{await computeRelationshipScore(orgId)}catch(e){failed++;console.error('[ARIA] relationship',e.message)}
 let processed=0;
 await mapConcurrent(ids,CONCURRENCY,async id=>{
  try{await updatePeopleIntelligence(id,orgId);await updatePersonState(id,orgId);processed++}
  catch(e){failed++;console.error('[ARIA] intelligence',id,e.message)}
 });
 let actions=[];
 try{actions=await generateCareRecommendations(orgId)}catch(e){failed++;console.error('[ARIA] care',e.message)}
 try{const due=await generateReturnDueActions(orgId);actions=actions.concat(Array.from({length:due},()=>({})));}catch(e){failed++;console.error('[ARIA] return-due',e.message)}
 if(failed&&!force)console.warn(`[ARIA] cycle completed with ${failed} failure(s)`);
 const durationMs=Date.now()-started;
 console.info('[ARIA] care cycle',JSON.stringify({organizationId:orgId,checked:ids.length,processed,failed,actions:actions.length,durationMs}));
 return{organizationId:orgId,processed,checked:ids.length,failed,actions:actions.length,ranAt:new Date().toISOString(),durationMs};
}
