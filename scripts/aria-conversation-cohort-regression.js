import fs from'fs';
import path from'path';

const root=process.cwd();
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const required=[
 ['lib/aria/conversationState.js','conversation_state','referenced_observations'],
 ['lib/aria/cohortEngine.js','past_absentees','inferCohortFromText'],
 ['lib/aria/batchDraftEngine.js','createCareDraftBatch','whatsappNote'],
 ['lib/aria/capabilityRegistry.js','get_observation_context','draft_message_cohort'],
 ['lib/aria/capabilityEngine.js','observationContext','draft_message_cohort'],
 ['lib/aria/commandEngine.js','draft_message_cohort'],
 ['lib/aria/cohortEngine.js','(?:for|to)','past_absentees'],
 ['lib/aria/conversationEngine.js','resolveConversationalFollowUp','get_observation_context'],
 ['pages/aria.js','MESSAGE DRAFTS','Open WhatsApp'],
 ['pages/index.js','Draft these follow-ups','/api/aria/draft-batch']
];
for(const [file,...needles] of required){
 const content=read(file);
 for(const needle of needles){
  if(!content.includes(needle))throw new Error(file+' is missing '+needle);
 }
}
const packageJson=JSON.parse(read('package.json'));
if(!packageJson.scripts?.['test:aria-conversation'])throw new Error('Missing test:aria-conversation script');
if(!String(packageJson.scripts?.test??'').includes('test:aria-conversation'))throw new Error('test:aria does not include conversation regression');
console.log('ARIA conversation/cohort/draft regression passed.');
