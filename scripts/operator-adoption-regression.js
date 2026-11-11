// scripts/operator-adoption-regression.js
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(path,'utf8');
const home=read('pages/index.js');
const homeApi=read('pages/api/home/bootstrap.js');
const work=read('components/WorkToday.js');
const supportUi=read('components/OperatorSupportRequest.js');
const supportApi=read('pages/api/operator-support.js');
const pulseUi=read('components/OperatorExperiencePulse.js');
const pulseApi=read('pages/api/operator-pulse.js');
const pulseMigration=read('supabase/migrations/20261111154000_operator_experience_pulses.sql');
const oversight=read('pages/api/care-oversight/index.js');
const acknowledge=read('pages/api/care-oversight/acknowledge.js');
const reassignApi=read('pages/api/care-oversight/reassign.js');
const queue=read('lib/dailyQueue.js');
const messaging=read('lib/aria/internalMessaging.js');
const oversightPage=read('pages/care-oversight.js');
const onboarding=read('components/FirstExperience.js');

const checks=[
 ['Home makes the existing personal daily queue the first actionable surface while preserving ARIA Today',home.includes('import WorkToday')&&home.includes('<WorkToday data={data}')&&home.includes('<button className="nyHomeBrief"')&&home.includes("const AttendanceModal=dynamic(()=>import('../components/AttendanceModal'),{ssr:false})")],
 ['Home passes the authenticated operator role and champion context instead of trusting client-selected role data',home.includes("operatorRole=String(data.operator?.role||'')")&&homeApi.includes('operator:{id:String(req.user.id),name:req.user.name||\'Operator\',role:req.user.role}')&&homeApi.includes('operator_champion:operatorChampion')],
 ['The work surface displays existing queue items, limits the preview and provides the canonical full briefing',work.includes('data?.queue')&&work.includes('items.slice(0,3)')&&work.includes('onOpenAll')&&work.includes('queue.laterCount')],
 ['Help requests are attached to a currently assigned responsibility and use the existing internal message system',supportApi.includes('assigned_user_id=$3')&&supportApi.includes("task_kind<>'internal_message'")&&supportApi.includes('sendInternalMessage')&&supportApi.includes("kind:'operator_support_request'")],
 ['Help request delivery is transparent, idempotent, routed to the persisted recipient and its state survives a page reload',supportApi.includes('idempotencyKey')&&supportApi.includes('metadata->>\'queue_item_id\'=$3')&&supportApi.includes('sent.message?.recipient_name')&&supportApi.includes("active=true AND role='user'")&&supportUi.includes('This goes to')&&supportUi.includes('existing request check failed')&&supportUi.includes('sensitive personal details')],
 ['Only the authenticated operator can submit their weekly pulse, with a bounded 1–5 scale and one record per week',pulseApi.includes("req.user.role!=='user'")&&pulseApi.includes('validScore')&&pulseApi.includes('week_start')&&pulseApi.includes('submitted_at')],
 ['Weekly pulse storage is tenant-scoped, unique per operator/week and denied to direct browser roles',pulseMigration.includes('UNIQUE (organization_id,operator_user_id,week_start)')&&pulseMigration.includes('ENABLE ROW LEVEL SECURITY')&&pulseMigration.includes('FORCE ROW LEVEL SECURITY')&&pulseMigration.includes('operator_experience_pulses_server_only_deny')],
 ['The pulse asks the three intended questions, discloses account linkage and suppresses averages until at least three responses',pulseUi.includes('responsibilities easier to manage')&&pulseUi.includes('expected to do')&&pulseUi.includes('feel confident')&&pulseUi.includes('linked to your account')&&pulseUi.includes('combined averages only')&&oversight.includes('sufficient_sample')&&oversight.includes('>=3')&&pulseMigration.includes('UNIQUE (organization_id,operator_user_id,week_start)')],
 ['Care Oversight is owner/admin-only and reuses the canonical ARIA director plus existing daily queue, care feedback and review records',oversight.includes('withAdmin')&&oversight.includes('getDirectorBriefing')&&oversight.includes('getDailyQueue')&&oversight.includes('FROM care_feedback')&&oversight.includes('FROM scan_review_items')],
 ['Care Oversight does not use raw login, route or screen activity as an adoption measure',!oversight.includes('FROM aria_activity_log')&&!oversight.includes('JOIN aria_activity_log')&&oversight.includes('completed_count')&&oversight.includes('repeat_days')],
 ['Leadership detail is role-scoped; owner/admin differences are enforced in the server query',oversight.includes("req.user.role==='owner'")&&oversight.includes("u.role='user' OR u.id=$3")&&oversight.includes("s.role='user' OR s.id=$2")],
 ['Leadership sees only aggregate pulse responses, not individual answer rows',oversight.includes('AVG(ease_score)')&&oversight.includes('AVG(clarity_score)')&&oversight.includes('AVG(confidence_score)')&&!oversight.includes('operator_user_id::text')],
 ['Champion selection is a designation, not a new permission role, and only active user-role operators are eligible',oversight.includes("role='user'")&&oversight.includes('operator_champion_user_id')&&oversightPage.includes('not a new permission role')],
 ['Only owner/admin can acknowledge support requests, and a different leader cannot mark the recipient inbox as read',acknowledge.includes('withAdmin')&&acknowledge.includes("metadata->>'kind'='operator_support_request'")&&acknowledge.includes('support_acknowledged_at')&&acknowledge.includes('support_acknowledged_by')&&acknowledge.includes('String(message.recipient_user_id)===String(req.user.id)')&&acknowledge.includes('support_request_acknowledged')],
 ['Only owner/admin can reassign real queue responsibilities, admins cannot reassign other leaders work, and internal messages are not reassigned',reassignApi.includes('withAdmin')&&reassignApi.includes('actorRole:req.user.role')&&reassignApi.includes('reassignDailyQueueItem')&&queue.includes("item.task_kind==='internal_message'")&&queue.includes("assignee.role='user'")&&queue.includes("$4='owner'")&&queue.includes("AND role='user'")&&queue.includes('queue_reassigned')],
 ['Reassignment preserves an audit event and does not rewrite canonical care or person records',queue.includes('assigned_user_id=$1,status=\'pending\'')&&queue.includes('aria_activity_log')&&queue.includes('aria_daily_queue_item')],
 ['First-time Home copy explains the purpose and visibility differently for operators and leaders',onboarding.includes("experience==='home'&&role==='user'")&&onboarding.includes("experience==='home'&&['owner','admin'].includes(role)")&&onboarding.includes('not rank your logins')]
];

const failures=checks.filter(([,ok])=>!ok).map(([name])=>name);
for(const[name,ok]of checks)console.log((ok?'PASS: ':'FAIL: ')+name);
if(failures.length){
 console.error('[OPERATOR ADOPTION] FAILED:',failures.join(' | '));
 process.exit(1);
}
console.log('[OPERATOR ADOPTION] User-first Home, leadership boundaries, support, reassignment and weekly pulse contracts passed.');
