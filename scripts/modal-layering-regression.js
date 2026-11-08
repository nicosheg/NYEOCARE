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

assert.match(documentSource, /id="nyeocare-modal-root"/, 'The modal root must be a body-level sibling of #__next.');
assert.match(appSource, /name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/, 'Mobile viewport metadata must be explicit.');
assert.match(appSource, /#nyeocare-modal-root\{[^}]*z-index:2147483646[^}]*isolation:isolate/s, 'The shared modal root must own a top-level stacking context.');
assert.match(appSource, /\.ny-modal-overlay[^}]*height:100dvh/s, 'Modal overlays must use the dynamic mobile viewport height.');
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

console.log('Modal layering regression checks passed.');
