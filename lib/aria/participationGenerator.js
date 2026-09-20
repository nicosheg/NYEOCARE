// lib/aria/participationGenerator.js
// Compatibility export. Attendance processing now lives in the durable,
// set-based attendanceProcessor instead of the old per-person fanout pipeline.
export { generateParticipationFromSession } from './attendanceProcessor';
export { processAttendanceSession, claimAttendanceProcessing, AttendanceProcessingBusyError } from './attendanceProcessor';
