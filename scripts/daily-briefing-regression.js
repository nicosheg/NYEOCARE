// scripts/daily-briefing-regression.js
import fs from 'fs';

const read=path=>fs.readFileSync(path,'utf8');
const home=read('pages/index.js');
const review=read('pages/api/review/index.js');
const briefing=read('pages/api/daily-briefing/latest.js');
const queue=read('lib/dailyQueue.js');
const defer=read('pages/api/daily-queue/defer.js');
const migration=read('supabase/migrations/20260927060000_add_aria_daily_queue.sql');

function assert(condition,message){if(!condition)throw new Error(message)}

assert(/briefDraftBar=/.test(home)&&/briefDraftList=/.test(home)&&/briefDraftItem=/.test(home),'Briefing follow-up view must define all draft styles it renders.');
assert(/ClientErrorBoundary surface="briefing"/.test(home)&&/ClientErrorBoundary surface="briefing-action"/.test(home),'ARIA Today surfaces must have local recovery boundaries.');
assert(/\/api\/daily-queue\/defer/.test(home)&&/queue_item_id:item\.queue_item_id/.test(home),'Daily queue items must defer without rejecting their underlying action.');
assert(/queueMetaBlock/.test(home)&&/Scheduled later/.test(home),'ARIA Today must expose compressed later-work state.');
assert(/scan_review_items/.test(review)&&!/attendanceItems/.test(review)&&/pending_count:scanItems\.length\+groups\.length/.test(review),'Review Center must exclude attendance follow-up queue work.');
assert(/getDailyQueue/.test(briefing)&&/capacityPerOperator:5/.test(briefing)&&/laterCount/.test(briefing),'Daily briefing API must be backed by the operator queue.');
assert(/aria_daily_queue_items/.test(queue)&&/DAY_CAPACITY=5/.test(queue)&&/role\s+IN\s*\('owner','admin'\)/.test(queue)&&/internal_message/.test(queue),'Daily queue must be durable, capped, message-aware and admin/owner distributed.');
assert(/row\.task_kind==='internal_message'/.test(queue)&&/item\.task_kind==='internal_message'/.test(queue),'Internal messages must not consume the five-item care queue capacity.');
assert(/queue_date/.test(defer)&&/deferDailyQueueItem/.test(defer),'Daily queue defer endpoint must reschedule work instead of rejecting it.');
assert(/UNIQUE \(organization_id, task_kind, source_id\)/.test(migration),'One active queue assignment must exist per source item.');
console.log('[DAILY BRIEFING] queue and crash regression checks passed.');
