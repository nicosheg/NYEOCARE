// scripts/critical-ui-regression.js
import{readFileSync}from'node:fs';

const file=readFileSync('components/AttendanceModal.js','utf8');
const home=readFileSync('pages/index.js','utf8');
const homeStyleNames=new Set([...home.matchAll(/\b([A-Za-z_$][\w$]*)=\{/g)].map(m=>m[1]));
const homeStyleRefs=[...new Set([...home.matchAll(/style=\{(?:\{\.\.\.)?([A-Za-z_$][\w$]*)/g)].map(m=>m[1]))];
const missingHomeStyles=homeStyleRefs.filter(x=>!homeStyleNames.has(x));
const activeApi=readFileSync('pages/api/attendance/active-session.js','utf8');
const director=readFileSync('lib/aria/director.js','utf8');
const eventProcessor=readFileSync('lib/aria/eventProcessor.js','utf8');
const briefing=readFileSync('pages/api/daily-briefing/latest.js','utf8');
const participation=readFileSync('lib/aria/participationGenerator.js','utf8');
const declaredStyles=new Set([...file.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*\{/g)].map(m=>m[1]));
const refs=new Set();
for(const m of file.matchAll(/style=\{([A-Za-z_$][\w$]*)\}/g))refs.add(m[1]);
for(const m of file.matchAll(/style=\{\{\.\.\.([A-Za-z_$][\w$]*)/g))refs.add(m[1]);
const missing=[...refs].filter(x=>!declaredStyles.has(x));
const forbidden=['/api/attendance/context','contextPerson','contextOverlay','contextCard','contextButton'];
const forbiddenFound=forbidden.filter(x=>file.includes(x));
const required=['normalizeSession','normalizePeople','readJson','loadSeq'];
const absent=required.filter(x=>!file.includes(x));
const semanticChecks=[
 ['Attendance API marks LIVE only for status=active',/active:row\.status==='active'/.test(activeApi)],
 ['Attendance loader accepts recoverable closed sessions',/if\(!sd\.active&&!sd\.recoverable\)/.test(file)],
 ['Homepage LIVE cue requires an active session',/d\?\.active===true&&d\?\.status==='active'/.test(home)],
 ['Homepage fetches ARIA Today without cache',/daily-briefing\/latest',\{headers:h,cache:'no-store'\}/.test(home)],
 ['Daily briefing never creates attendance actions',!/INSERT INTO aria_actions/.test(briefing)],
 ['Daily briefing is explicitly uncached',/Cache-Control.*no-store/.test(briefing)],
 ['Daily briefing surfaces attendance actions first',/first_session_check_in/.test(briefing)],
 ['Attendance processor owns first-session follow-up',/first_session_check_in/.test(participation)&&/session_id:sessionId/.test(participation)]
];
const semanticFailures=semanticChecks.filter(([,ok])=>!ok).map(([name])=>name);
if(missing.length||missingHomeStyles.length||forbiddenFound.length||absent.length||semanticFailures.length){
 console.error('[CRITICAL UI] Attendance regression guard failed.');
 if(missing.length)console.error('Undefined Attendance style identifiers:',missing.join(', '));
 if(missingHomeStyles.length)console.error('Undefined Home style identifiers:',missingHomeStyles.join(', '));
 if(forbiddenFound.length)console.error('Removed attendance-context remnants:',forbiddenFound.join(', '));
 if(absent.length)console.error('Missing hardening primitives:',absent.join(', '));
 if(semanticFailures.length)console.error('Broken attendance lifecycle semantics:',semanticFailures.join(' | '));
 process.exit(1);
}
console.log('[CRITICAL UI] Attendance + ARIA pipeline regression guards passed.');
