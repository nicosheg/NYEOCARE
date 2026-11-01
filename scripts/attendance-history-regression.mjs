// scripts/attendance-history-regression.mjs
import fs from 'node:fs';
const read=path=>fs.readFileSync(path,'utf8');
const historyPanel=read('components/AttendanceHistoryPanel.js');
const checks=[
  ['history API is organization-authenticated',read('pages/api/attendance/history.js').includes('withOrg')],
  ['canonical summary distinguishes confirmed attendance',read('lib/attendance/history.js').includes('ar.present=true AND ar.confirmed=true')],
  ['history person joins are tenant-scoped',read('lib/attendance/history.js').includes('p.organization_id=ar.organization_id')],
  ['ARIA has an attendance history capability',read('lib/aria/capabilityRegistry.js').includes('get_attendance_history')],
  ['post-save result is shown in Attendance',read('components/AttendanceModal.js').includes('Attendance saved')],
  ['history records disclose current section assignment',read('components/AttendanceHistoryPanel.js').includes('current People assignment')],
  ['history processing status never shadows its layout style object',historyPanel.includes("const processingStatus=detail?.session?.aria_processing_status")&&historyPanel.includes("const processing={display:'flex'")&&historyPanel.includes('<div style={processing}>')&&historyPanel.includes("processingStatus==='completed'")&&!historyPanel.includes("const processing=detail?.session?.aria_processing_status")]
];
const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks)console.log((ok?'PASS: ':'FAIL: ')+name);
if(failed.length)process.exit(1);
