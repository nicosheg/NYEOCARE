// lib/aria/director.js
import{resolveIdentities}from'../identityResolver';
import pool from'../db';
import{getOrganizationChanges}from'./temporalEngine';
import{getDirectorBriefing}from'./directorEngine';
import{getAttentionSummary}from'./attentionEngine';
import{refreshLivingTruth,getLivingTruth}from'./truthEngine';
export const ARIA_DIRECTOR_VERSION='4.1.0';
export async function handleScanEvent(extractedPeople,orgId,scanJobId,client,context=null){if(!client)throw new Error('Scan identity resolution requires an active database transaction');const decisions=await resolveIdentities(extractedPeople,orgId,scanJobId,client,context),resolvedPeople=[],needsReview=[];for(const decision of decisions){if(decision.status==='alive'&&decision.best_candidate_id)resolvedPeople.push({name:decision.extracted_name,phone:decision.extracted_phone,resolved_person_id:decision.best_candidate_id,status:'alive',confidence:decision.confidence});else if(decision.status==='conflict'||decision.status==='needs_decision')needsReview.push({...decision,resolved:false})}return{decisions,resolvedPeople,needsReview,context:context||null}}
export async function directAriaEvent(event){if(!event?.organization_id||!event?.type)throw new Error('A valid ARIA event is required');const{processAriaEvent}=await import('./eventProcessor');return processAriaEvent(event)}
export async function emitAndDirectAriaEvent({eventEmitterArgs,client=null}){const{emitAriaEvent}=await import('./eventEmitter');const event=await emitAriaEvent({...eventEmitterArgs},client);if(!event)return null;return{event,observation_id:await directAriaEvent(event)}}
export async function getDirectorContext({organizationId,viewerId,personId=null}={}){if(!organizationId||!viewerId)throw Object.assign(new Error('Director context requires an authenticated operator.'),{status:401});const[briefing,truth]=await Promise.all([getDirectorBriefing(organizationId,{limit:8}),personId?getLivingTruth({organizationId,personId}):Promise.resolve(null)]);return{director:'ARIA',version:ARIA_DIRECTOR_VERSION,generated_at:new Date().toISOString(),briefing,living_truth:truth};}
export async function refreshPersonTruth(organizationId,personId){return refreshLivingTruth({organizationId,personId});}
export async function getDirectorState(organizationId){if(!organizationId)throw new Error('organizationId required');const[rules,scan,session,observations,actions,events,changes,attention]=await Promise.all([
 pool.query('SELECT COUNT(*)::int count FROM people WHERE organization_id=$1 AND COALESCE(status,\'active\')=\'active\'',[organizationId]),
 pool.query('SELECT COUNT(*)::int count FROM scan_review_items WHERE organization_id=$1 AND status=\'pending\'',[organizationId]),
 pool.query('SELECT id,name,status,aria_processing_status,aria_processing_error FROM sessions WHERE organization_id=$1 ORDER BY started_at DESC NULLS LAST LIMIT 1',[organizationId]),
 pool.query('SELECT COUNT(*)::int count FROM aria_observations WHERE organization_id=$1 AND status=\'active\' AND(expires_at IS NULL OR expires_at>NOW())',[organizationId]),
 pool.query('SELECT COUNT(*)::int count FROM aria_actions WHERE organization_id=$1 AND status IN(\'proposed\',\'approved\') AND(expires_at IS NULL OR expires_at>NOW())',[organizationId]),
 pool.query('SELECT MAX(occurred_at) AS last_event_at FROM aria_events WHERE organization_id=$1',[organizationId])
 ]);return{director:'ARIA',version:ARIA_DIRECTOR_VERSION,people:rules.rows[0].count,pending_scan_reviews:scan.rows[0].count,latest_session:session.rows[0]||null,active_observations:observations.rows[0].count,open_actions:actions.rows[0].count,last_event_at:events.rows[0]?.last_event_at||null}}
export async function initializeCommunity(orgId){return{organizationId:orgId,initialized:true,director:'ARIA',version:ARIA_DIRECTOR_VERSION}}