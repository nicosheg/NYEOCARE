// scripts/aria-organizational-intelligence-v2-regression.js
import{readFileSync}from'node:fs';
const read=p=>readFileSync(p,'utf8');
const files={
 createSession:read('pages/api/attendance/create-session.js'),
 attendanceProcessor:read('lib/aria/attendanceProcessor.js'),
 memory:read('lib/aria/memoryEngine.js'),
 truth:read('lib/aria/truthEngine.js'),
 careContacts:read('lib/aria/careContacts.js'),
 care:read('lib/aria/careEngine.js'),
 recommendation:read('lib/aria/recommendationEngine.js'),
 budget:read('lib/budgetGuard.js'),
 gateway:read('lib/aiGateway.js'),
 clientSession:read('lib/clientSession.js'),
 authKeeper:read('components/AuthSessionKeeper.js'),
 outcome:read('lib/aria/outcomeEngine.js'),
 processor:read('lib/aria/eventProcessor.js'),
 migration:read('supabase/migrations/20260925213000_aria_intelligence_v2_security_and_event_semantics.sql'),
 spec:read('NYEO_SPEC.md')
};
const organizationExpression='\$'+'{organizationId}';
const checks=[
 ['New attendance events do not assume absence is meaningful',files.createSession.includes("absence_meaningful=false")&&files.createSession.includes("absence_meaningful===true")],
 ['Attendance absence logic respects event semantics',files.attendanceProcessor.includes('latest.absence_meaningful=true')&&files.attendanceProcessor.includes('latest.participation_expected=true')&&files.attendanceProcessor.includes('latest.optional=false')],
 ['Group-scoped events restrict absence candidates to active group members',files.attendanceProcessor.includes("latest.event_scope='group'")&&files.attendanceProcessor.includes('person_memberships')],
 ['Temporal memory stores importance and validity',files.memory.includes("importance='temporary'")&&files.memory.includes('validUntil')&&files.memory.includes('valid_until')],
 ['Conflicting memory reports are explicit',files.memory.includes("conflicts=Boolean")&&files.memory.includes("'conflicted'")&&files.truth.includes("verification_status==='conflicted'")],
 ['Living Truth surfaces recent conflicting memory claims',files.truth.includes("OR(verification_status='conflicted'")&&files.truth.includes("memory.rows.filter(m=>m.verification_status==='conflicted')")],
 ['Care contact signals use relationships and successful outcomes',files.careContacts.includes('person_relationships')&&files.careContacts.includes('intelligence_outcomes')&&files.careContacts.includes('success_count')],
 ['Care does not auto-assign a contact; it stores ranked evidence candidates',files.care.includes('care_contact_candidates')&&files.care.includes('requires_human_approval')],
 ['ARIA actions persist concise evidence summaries',files.recommendation.includes('evidence_summary')&&files.recommendation.includes('facts:Array.isArray(ev.facts)')],
 ['Budget reservations serialize on the organization, not the purpose',files.budget.includes('nyeocare-budget:'+organizationExpression)&&!files.budget.includes('nyeocare-budget:'+organizationExpression+':'+ 'purpose')],
 ['Voice transcription is behind the same budget guard',files.gateway.includes("reserveBudget(organizationId,purpose,STT_MODEL_KEY)")&&files.gateway.includes('confirmReservation(reservationId,reservationCost)')],
 ['Voice synthesis is behind the same budget guard',files.gateway.includes("reserveBudget(organizationId,purpose,TTS_MODEL_KEY)")&&files.gateway.includes("purpose,prompt_version:'v1'")],
 ['Auth keeps refresh operations single-flight',files.clientSession.includes('refreshInFlight')&&files.clientSession.includes('getSession()')&&files.clientSession.includes('refreshSession()')],
 ['Auth session keeper is passive',files.authKeeper.includes('Session warm failed')&&!files.authKeeper.includes('signOut')],
 ['Outcomes re-enter the canonical ARIA event stream',files.outcome.includes('CARE_OUTCOME_RECORDED')&&files.outcome.includes("eventKey:'outcome:'+outcome.id")],
 ['Event processor recognizes care outcomes',files.processor.includes('CARE_OUTCOME_RECORDED')],
 ['Internal ARIA tables are server-owned in browser RLS',files.migration.includes('person_memory_admin_select')&&files.migration.includes('aria_actions_admin_select')&&files.migration.includes("FOREACH t IN ARRAY ARRAY[")&&files.migration.includes("t||'_org'")],
 ['Conversation reads are owner/admin scoped',files.migration.includes('aria_conversations_admin_or_owner_select')&&files.migration.includes('aria_messages_admin_or_owner_select')],
 ['The spec records the continuation architecture',files.spec.includes('## 57. SEPTEMBER 25, 2026 — ARIA ORGANIZATIONAL INTELLIGENCE V2')]
];
const failures=checks.filter(([,ok])=>!ok).map(([name])=>name);
if(failures.length){console.error('[ARIA V2] FAILED');console.error(failures.join(' | '));process.exit(1);}
console.log('[ARIA V2] Organizational intelligence regression guards passed.');
