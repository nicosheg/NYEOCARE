// components/AttendanceTab.js
// FIDUCIA CARE — Legacy compatibility wrapper.
// Attendance is now owned by AttendanceModal.js.

import AttendanceModal from './AttendanceModal';import ClientErrorBoundary from './ClientErrorBoundary';

export default function AttendanceTab({onClose,isOpen=true}){
 return <ClientErrorBoundary surface="attendance-tab" fallback={<div style={{padding:24,textAlign:'center',color:'var(--ny-text)'}}><strong>Attendance needs to be reopened.</strong><p style={{color:'var(--ny-text-muted)'}}>The saved attendance data is protected. Close this view and open Attendance again.</p><button onClick={onClose} style={{padding:'10px 15px',border:0,borderRadius:999,background:'var(--ny-text)',color:'var(--ny-bg)',fontWeight:700}}>Back</button></div>}><AttendanceModal isOpen={isOpen} onClose={onClose}/></ClientErrorBoundary>;
}
