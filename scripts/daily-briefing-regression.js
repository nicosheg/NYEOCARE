// scripts/daily-briefing-regression.js
import fs from 'fs';

const read=path=>fs.readFileSync(path,'utf8');
const home=read('pages/index.js');
const review=read('pages/api/review/index.js');
const briefing=read('pages/api/daily-briefing/latest.js');
const queue=read('lib/dailyQueue.js');
const homeBootstrap=read('pages/api/home/bootstrap.js');
const briefingProjection=read('lib/aria/briefingProjection.js');
const briefingCore=read('lib/aria/dailyBriefing.js');
const defer=read('pages/api/daily-queue/defer.js');
const migration=read('supabase/migrations/20260927060000_add_aria_daily_queue.sql');

function assert(condition,message){if(!condition)throw new Error(message)}

assert(/briefDraftBar=/.test(home)&&/briefDraftList=/.test(home)&&/briefDraftItem=/.test(home),'Briefing follow-up view must define all draft styles it renders.');
assert(/ClientErrorBoundary surface="briefing"/.test(home)&&/ClientErrorBoundary surface="briefing-action"/.test(home),'ARIA Today surfaces must have local recovery boundaries.');
assert(/\/api\/daily-queue\/defer/.test(home)&&/queue_item_id:item\.queue_item_id/.test(home),'Daily queue items must defer without rejecting their underlying action.');
assert(/queueMetaBlock/.test(home)&&/Scheduled later/.test(home),'ARIA Today must expose compressed later-work state.');
assert(/scan_review_items/.test(review)&&!/attendanceItems/.test(review)&&/pending_count:scanItems\.length\+groups\.length/.test(review),'Review Center must exclude attendance follow-up queue work.');
assert(/getDailyQueue/.test(briefing)&&/capacityPerOperator:queue\.capacityPerOperator\|\|5/.test(briefing)&&/laterCount/.test(briefing),'Daily briefing API must be backed by the operator queue and expose configured capacity.');
assert(/getDirectorBriefing/.test(briefingCore)&&/getDailyBriefingSnapshot/.test(briefingCore)&&!/runCareCycle/.test(briefingCore)&&!/careCycle/.test(briefingCore),'Generating a historical briefing snapshot must not run a second care/action-generation pipeline.');
assert(/projectCanonicalBriefingItems\(queue,directorBriefing\)/.test(briefing)&&/projectCanonicalBriefingItems\(dailyQueue,directorData\)/.test(homeBootstrap)&&/candidateItems/.test(briefingProjection)&&/notDuplicateIdentityPairs/.test(briefingProjection)&&/identity_pair_decisions/.test(queue),'Home and the Daily Briefing API must use the same current/future briefing projection and respect durable keep-separate decisions.');
assert(/identity:items\.filter/.test(briefing)&&/groupedCounts\.identity\+\+/.test(briefing)&&/task_kind==='internal_message'/.test(briefing),'Daily briefing categories must count duplicate-identity warnings and operator messages separately from care work.');
assert(/UPPER\(o\.type\)<>'NEW_PERSON'/.test(queue),'Person-created observations alone must not create a human action or welcome follow-up.');
assert(/COALESCE\(a\.action_metadata->>'kind',''\)='new_person_welcome'[\s\S]{0,160}COALESCE\(a\.action_metadata->>'source_event_type',''\)='PERSON_CREATED'/.test(queue),'Legacy welcome proposals caused by person creation must stay out of current/future operator briefings.');
assert(/aria_daily_queue_items/.test(queue)&&/DAY_CAPACITY=5/.test(queue)&&/role\s+IN\s*\('owner','admin','leader','worker'(?:,'user')?\)/.test(queue)&&/followUpPolicy\.workerDailyCapacity/.test(queue)&&/internal_message/.test(queue)&&/todayLoad/.test(queue),'Daily queue must be durable, policy-capped, message-aware and distributed across eligible active operators.');
assert(!/\\\$\{/.test(queue),'Daily queue interpolation must remain executable; escaped template placeholders must never reach production.');
assert(/row\.task_kind==='internal_message'/.test(queue)&&/item\.task_kind==='internal_message'/.test(queue),'Internal messages must not consume the five-item care queue capacity.');
assert(/queue_date/.test(defer)&&/deferDailyQueueItem/.test(defer),'Daily queue defer endpoint must reschedule work instead of rejecting it.');
assert(/UNIQUE \(organization_id, task_kind, source_id\)/.test(migration),'One active queue assignment must exist per source item.');
console.log('[DAILY BRIEFING] queue and crash regression checks passed.');
