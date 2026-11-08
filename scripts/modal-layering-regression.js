// scripts/modal-layering-regression.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const documentSource = read('pages/_document.js');
const appSource = read('pages/_app.js');
const portalSource = read('components/ModalPortal.js');
const homeSource = read('pages/index.js');
const scanSource = read('components/ScanModal.js');
const attendanceSource = read('components/AttendanceModal.js');
const historySource = read('components/AttendanceHistoryPanel.js');
const reviewSource = read('components/ReviewCenterTab.js');
const firstExperienceSource = read('components/FirstExperience.js');

assert.match(documentSource, /id="nyeocare-modal-root"/, 'The modal root must be a body-level sibling of #__next.');
assert.match(appSource, /name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/, 'Mobile viewport metadata must be explicit.');
assert.match(appSource, /#nyeocare-modal-root\{[^}]*z-index:2147483647[^}]*isolation:isolate/s, 'The shared modal root must own a top-level stacking context.');
assert.match(appSource, /top:0!important;right:0!important;bottom:0!important;left:0!important/, 'The shared overlay must not depend on the CSS inset shorthand.');
assert.match(appSource, /height:100vh!important;height:100dvh!important/, 'A legacy viewport-height fallback must precede the dynamic viewport unit.');
assert.match(appSource, /#nyeocare-modal-root \.ny-modal-panel\{box-sizing:border-box;min-height:0\}/, 'The shared layer must not override individual modal height constraints.');
assert.match(appSource, /pointer-events:auto!important/, 'Modal overlays must remain interactive inside the pointer-transparent portal root.');
assert.match(portalSource, /getElementById\('nyeocare-modal-root'\)/, 'ModalPortal must target the shared root.');
assert.match(portalSource, /root \|\| document\.body/, 'ModalPortal must retain a safe fallback.');

for (const [name, source] of [
  ['Home', homeSource],
  ['Scan', scanSource],
  ['Attendance', attendanceSource],
  ['Attendance history', historySource]
]) {
  assert.match(source, /ModalPortal/, name + ' must use the shared portal.');
  assert.doesNotMatch(source, /createPortal\(/, name + ' must not maintain its own portal target.');
  assert.match(source, /ny-modal-overlay/, name + ' overlay must opt into shared viewport rules.');
}

for (const [name, source] of [
  ['Home', homeSource],
  ['Scan', scanSource],
  ['Attendance', attendanceSource],
  ['Attendance history', historySource],
  ['Review', reviewSource],
  ['First experience', firstExperienceSource]
]) {
  assert.match(source, /top:0(?:!important)?[;,]right:0(?:!important)?[;,]bottom:0(?:!important)?[;,]left:0(?:!important)?/, name + ' must explicitly define all four fixed-position edges for older browsers.');
}
assert.match(firstExperienceSource, /<ModalPortal><div className="experienceOverlay ny-modal-overlay">/, 'First experience must be rendered outside the Home layout as well.');
assert.match(attendanceSource, /const mobileModal=\{\.\.\.modal,width:'100%',height:'88vh',maxHeight:'88vh'/, 'Attendance mobile sizing must have a vh fallback for browsers without dvh or min().');
assert.match(historySource, /height:compact\?'100vh':'90vh',maxHeight:compact\?'100vh':860/, 'Attendance history sizing must use the legacy viewport unit.');

console.log('Modal layering regression checks passed.');
