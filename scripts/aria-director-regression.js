import fs from'fs';
import path from'path';

const root=process.cwd();
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

const required=[
 ['lib/aria/directorEngine.js','ARIA_DIRECTOR_CORE_VERSION','getDirectorBriefing','directorAnswerInstructions','reconcileAttendanceCandidate','choosePrimary'],
 ['lib/aria/capabilityRegistry.js','get_director_briefing'],
 ['lib/aria/capabilityEngine.js','getDirectorBriefing','case\'get_director_briefing\''],
 ['lib/aria/commandEngine.js','get_director_briefing','what matters most','brief current organization state'],
 ['lib/aria/conversationEngine.js','directorAnswerInstructions','Canonical ARIA Director state','get_director_briefing'],
 ['lib/aria/conversationState.js','get_director_briefing','state.director','human_focus'],
 ['pages/api/aria/daily.js','getDirectorBriefing','director','peopleAddedLast7Days'],
 ['lib/aria/director.js','getDirectorBriefing','briefing'],
 ['lib/aria/priorityQueue.js','ATTENTION_OBSERVATION_TYPES','UNUSUAL_ABSENCE'],
 ['lib/aria/corePersonality.js','synchronized intelligence','one organizational mind'],
 ['pages/aria.js','todayInsight','daily.director?.primary_focus']

];

for(const [file,...needles] of required){
 const content=read(file);
 for(const needle of needles){
  if(!content.includes(needle))throw new Error(file+' is missing '+needle);
 }
}

const packageJson=JSON.parse(read('package.json'));
if(!packageJson.scripts?.['test:aria-director'])throw new Error('Missing test:aria-director script');
if(!String(packageJson.scripts?.test??'').includes('test:aria-conversation'))throw new Error('Main test script regression');
if(!String(packageJson.scripts?.['test:aria']??'').includes('test:aria-director'))throw new Error('test:aria does not include director regression');

console.log('ARIA director architecture regression passed.');
