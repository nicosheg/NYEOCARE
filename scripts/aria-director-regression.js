import fs from'fs';
import path from'path';

const root=process.cwd();
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

const required=[
 ['lib/aria/directorEngine.js','ARIA_DIRECTOR_CORE_VERSION','getDirectorBriefing','directorAnswerInstructions','reconcileAttendanceCandidate','choosePrimary'],
 ['lib/aria/capabilityRegistry.js','get_director_briefing'],
 ['lib/aria/capabilityEngine.js','getDirectorBriefing','case\'get_director_briefing\''],
 ['lib/aria/commandEngine.js','view_aria_director_briefing','get_director_briefing'],
 ['lib/aria/conversationEngine.js','directorAnswerInstructions','Canonical ARIA Director state','get_director_briefing'],
 ['lib/aria/conversationState.js','get_director_briefing','decisions?.human_focus'],
 ['pages/api/aria/daily.js','getDirectorBriefing','director','memoryCoverage'],
 ['lib/aria/director.js','getDirectorBriefing','briefing'],
 ['lib/aria/eventProcessor.js','successful attendance processing','aria_processing_failure']
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
