// scripts/aria-proactive-regression.js
import{readFileSync}from'node:fs';
const read=p=>readFileSync(p,'utf8');
const f={
 core:read('lib/aria/corePersonality.js'),
 care:read('lib/aria/careEngine.js'),
 priority:read('lib/aria/priorityQueue.js'),
 home:read('pages/api/home/bootstrap.js'),
 people:read('pages/api/people.js'),
 command:read('lib/aria/commandEngine.js'),
 conversation:read('lib/aria/conversationEngine.js'),
 draft:read('lib/aria/draftEngine.js'),
 capability:read('lib/aria/capabilityEngine.js')
};
const checks=[
 ['Core personality has proactive loops',f.core.includes('NOTICE')&&f.core.includes('STRENGTHEN')&&f.core.includes('INVITE')&&f.core.includes('LEARN')],
 ['Core personality protects autonomy',f.core.includes('never manufacture guilt, fear, urgency or dependency')&&f.core.includes('free to choose their level of involvement')],
 ['Core personality keeps consequential actions human-approved',f.core.includes('Human approval remains the final gate')],
 ['Care engine recognizes positive opportunities',f.care.includes("'recognition' kind")&&f.care.includes("'belonging' kind")&&f.care.includes("'serve_discovery' kind")],
 ['Priority queue surfaces positive opportunities',f.priority.includes('recognition_opportunity')&&f.priority.includes('belonging_opportunity')&&f.priority.includes('contribution_opportunity')],
 ['Home labels proactive opportunities',f.home.includes('proactiveLabels')&&f.home.includes('proactiveActions')],
 ['People API serializes attendance timestamps safely',f.people.includes("to_char(MAX(pr.occurred_at AT TIME ZONE 'UTC')")],
 ['Command planning uses proactive rules',f.command.includes('Be proactive when evidence supports a helpful next step')],
 ['Conversation uses core personality',f.conversation.includes('ARIA_CORE_PERSONALITY')],
 ['Care drafts use core personality',f.draft.includes('ARIA_CORE_PERSONALITY')],
 ['Organization context includes operator support',f.capability.includes('operatorSupport')]
];
const failures=checks.filter(([,ok])=>!ok).map(([name])=>name);
if(failures.length){console.error('[ARIA PROACTIVE] FAILED');console.error(failures.join(' | '));process.exit(1)}
console.log('[ARIA PROACTIVE] Proactive personality, positive care signals, autonomy, operator support, and attendance serialization guards passed.');
