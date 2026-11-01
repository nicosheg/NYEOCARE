// scripts/attendance-history-regression.mjs
import fs from 'node:fs';
const read=path=>fs.readFileSync(path,'utf8');
const historyPanel=read('components/AttendanceHistoryPanel.js');
const historyService=read('lib/attendance/history.js');
const attendanceModal=read('components/AttendanceModal.js');
const capabilityRegistry=read('lib/aria/capabilityRegistry.js');
const checks=[
  ['history API is organization-authenticated',read('pages/api/attendance/history.js').includes('withOrg')],
  ['saved history counts recorded present and absent marks without a review bucket',historyService.includes('COUNT(ar.id) FILTER(WHERE ar.present=true)::int AS present_count')&&historyService.includes('COUNT(ar.id) FILTER(WHERE ar.present=false)::int AS absent_count')&&!historyService.includes('pending_review_count')],
  ['section breakdown includes every recorded present mark',historyService.includes('WHERE ar.organization_id=$1 AND ar.session_id=$2 AND ar.present=true GROUP BY 1')],
  ['history person joins are tenant-scoped',historyService.includes('p.organization_id=ar.organization_id')],
  ['ARIA describes saved history as recorded present/absent counts',capabilityRegistry.includes('canonical recorded-present and recorded-absent totals')&&!capabilityRegistry.includes('review state and People-section breakdown')],
  ['post-save result uses recorded, present and absent totals',attendanceModal.includes('savedResult.totals.present_count')&&attendanceModal.includes('savedResult.totals.absent_count')&&!attendanceModal.includes('savedResult.totals.pending_review_count')],
  ['history records use only Present or Absent labels',historyPanel.includes("record.present?'Present':'Absent'")&&!historyPanel.includes('Needs review')],
  ['history session cards show present and absent counts',historyPanel.includes('item.present_count')&&historyPanel.includes('item.absent_count')&&!historyPanel.includes('item.pending_review_count')],
  ['history records disclose current section assignment',historyPanel.includes('current People assignment')],
  ['history processing status never shadows its layout style object',historyPanel.includes("const processingStatus=detail?.session?.aria_processing_status")&&historyPanel.includes("const processing={display:'flex'")&&historyPanel.includes('<div style={processing}>')&&historyPanel.includes("processingStatus==='completed'")&&!historyPanel.includes("const processing=detail?.session?.aria_processing_status")],
  ['history uses browser back navigation and has no close X control',historyPanel.includes("window.addEventListener('popstate',handlePopState)")&&historyPanel.includes('window.history.pushState')&&historyPanel.includes('window.history.back()')&&!historyPanel.includes('aria-label="Close history"')&&!historyPanel.includes('style={close}')]
];
const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks)console.log((ok?'PASS: ':'FAIL: ')+name);
if(failed.length)process.exit(1);
