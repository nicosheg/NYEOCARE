// lib/aria/director.js
import{resolveIdentities}from'../identityResolver';
import pool from'../db';
export const ARIA_DIRECTOR_VERSION='2.0.0';
export async function handleScanEvent(extractedPeople,orgId,scanJobId,client,context=null){if(!client)throw new Error('Scan identity resolution requires an active database transaction');const decisions=await resolveIdentities(extractedPeople,orgId,scanJobId,client,context),resolvedPeople=[],needsReview=[];for(const decision of decisions){if(decision.status==='alive'&&decision.best_candidate_id)resolvedPeople.push({name:decision.extracted_name,phone:decision.extracted_phone,resolved_person_id:decision.best_candidate_id,status:'alive',confidence:decision.confidence});else if(decision.status==='conflict'||decision.status==='needs_decision')needsReview.push({...decision,resolved:false})}return{decisions,resolvedPeople,needsReview,context:context||null}}
export async function directAriaEvent(event){if(!event?.organization_id||!event?.type)throw new Error('A valid ARIA event is required');const{processAriaEvent}=await import('./eventProcessor');return processAriaEvent(event)}
export async function emitAndDirectAriaEvent({eventEmitterArgs,client=null}){const{emitAriaEvent}=await import('./eventEmitter');const event=await emitAriaEvent({...eventEmitterArgs},client);if(!event)return null;return{event,observation_id:await directAriaEvent(event)}}
export async function getDirectorState(organizationId){if(!organizationId)throw new Error('organizationId required');const[rules,scan,session,observations,actions]=await Promise.all([
 pool.query('SELECT COUNT(*)::int count FROM people WHERE organization_id=$1 AND COALESCE(status,\'active\')=\'active\'',[organizationId]),
 pool.query('SELECT COUNT(*)::int count FROM scan_review_items WHERE organization_id=$1 AND status=\'pending\'',[organizationId]),
 pool.query('SELECT id,name,status,aria_processing_status,aria_processing_error FROM sessions WHERE organization_id=$1 ORDER BY started_at DESC NULLS LAST LIMIT 1',[organizationId]),
 pool.query('SELECT COUNT(*)::int count FROM aria_observations WHERE organization_id=$1 AND status=\'active\' AND(expires_at IS NULL OR expires_at>NOW())',[organizationId]),
 pool.query('SELECT COUNT(*)::int count FROM aria_actions WHERE organization_id=$1 AND status IN(\'proposed\',\'approved\') AND(expires_at IS NULL OR expires_at>NOW())',[organizationId])
 ]);return{director:'ARIA',version:ARIA_DIRECTOR_VERSION,people:rules.rows[0].count,pending_scan_reviews:scan.rows[0].count,latest_session:session.rows[0]||null,active_observations:observations.rows[0].count,open_actions:actions.rows[0].count}}
export async function initializeCommunity(orgId){return{organizationId:orgId,initialized:true,director:'ARIA',version:ARIA_DIRECTOR_VERSION}}