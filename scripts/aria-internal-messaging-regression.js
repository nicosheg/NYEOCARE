import fs from 'fs';

const read=path=>fs.readFileSync(path,'utf8');
const registry=read('lib/aria/capabilityRegistry.js');
const command=read('lib/aria/commandEngine.js');
const conversation=read('lib/aria/conversationEngine.js');
const state=read('lib/aria/conversationState.js');
const messaging=read('lib/aria/internalMessaging.js');
const queue=read('lib/dailyQueue.js');
const readApi=read('pages/api/internal-messages/read.js');
const briefing=read('pages/api/daily-briefing/latest.js');
const home=read('pages/index.js');
const migration=read('supabase/migrations/20260927070000_add_aria_internal_messages.sql');

function assert(condition,message){if(!condition)throw new Error(message)}

assert(/send_internal_message/.test(registry)&&/unsend_internal_message/.test(registry)&&/get_internal_messages/.test(registry),'Internal messaging capabilities must be registered.');
assert(/parseInternalMessageIntent/.test(command)&&/explicit:true/.test(command),'Internal message sending must use deterministic explicit intent parsing.');
assert(/resolveInternalRecipient/.test(command)&&/sendInternalMessage/.test(command)&&/unsendInternalMessage/.test(command),'Command execution must use the organization-scoped internal messaging service.');
assert(/referenced_internal_messages/.test(state)&&/internal_message/.test(state),'Conversation state must retain internal message references for follow-up commands.');
assert(/organization_id=\$1/.test(messaging)&&/sender_user_id=\$2/.test(messaging)&&/recipient_user_id/.test(messaging),'Internal messaging must remain organization and operator scoped.');
assert(/status='unsent'/.test(messaging)&&/sender_user_id=\$3/.test(messaging),'Only the original sender may unsend a message.');
assert(/seen_at/.test(messaging)&&/MESSAGE_UNSENT/.test(messaging),'Read/unsend race handling must be explicit.');
assert(/aria_daily_queue_items/.test(messaging)&&/task_kind='internal_message'/.test(messaging),'Internal message lifecycle must synchronize with the daily queue.');
assert(/fixed_assignee_id/.test(queue)&&/m\.seen_at IS NULL/.test(queue),'Internal messages must remain pinned to the recipient and only unseen messages enter the daily queue.');
assert(/task_kind==='internal_message'/.test(home)&&/api\/internal-messages\/read/.test(home)&&/refreshTimer/.test(home),'ARIA Today must surface, read, and refresh internal messages.');
assert(/internal_message/.test(briefing)&&/message:items/.test(briefing),'Daily briefing API must expose the message category.');
assert(/CREATE TABLE IF NOT EXISTS public\.aria_internal_messages/.test(migration)&&/ENABLE ROW LEVEL SECURITY/.test(migration)&&/server_only_deny/.test(migration),'Internal messages and daily queue must be protected by server-only RLS.');
assert(/task_kind IN \('scan_review','follow_up','action','observation','internal_message'\)/.test(migration),'Daily queue must accept the internal_message task kind.');
console.log('[ARIA INTERNAL MESSAGING] regression checks passed.');
