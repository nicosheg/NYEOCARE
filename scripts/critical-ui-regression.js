// scripts/critical-ui-regression.js
import{readFileSync}from'node:fs';

const file=readFileSync('components/AttendanceModal.js','utf8');
const declaredStyles=new Set([...file.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*\{/g)].map(m=>m[1]));
const refs=new Set();
for(const m of file.matchAll(/style=\{([A-Za-z_$][\w$]*)\}/g))refs.add(m[1]);
for(const m of file.matchAll(/style=\{\{\.\.\.([A-Za-z_$][\w$]*)/g))refs.add(m[1]);
const missing=[...refs].filter(x=>!declaredStyles.has(x));
const forbidden=['/api/attendance/context','contextPerson','contextOverlay','contextCard','contextButton'];
const forbiddenFound=forbidden.filter(x=>file.includes(x));
const required=['normalizeSession','normalizePeople','readJson','loadSeq'];
const absent=required.filter(x=>!file.includes(x));
if(missing.length||forbiddenFound.length||absent.length){
 console.error('[CRITICAL UI] Attendance regression guard failed.');
 if(missing.length)console.error('Undefined style identifiers:',missing.join(', '));
 if(forbiddenFound.length)console.error('Removed attendance-context remnants:',forbiddenFound.join(', '));
 if(absent.length)console.error('Missing hardening primitives:',absent.join(', '));
 process.exit(1);
}
console.log('[CRITICAL UI] Attendance render/persistence guards passed.');
