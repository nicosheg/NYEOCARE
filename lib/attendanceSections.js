// lib/attendanceSections.js
// Shared, explicit People-section vocabulary for People and Attendance.
const options=[
  {value:'men',label:'Men',description:'Adult men'},
  {value:'women',label:'Women',description:'Adult women'},
  {value:'youth',label:'Youth',description:'Youth section'},
  {value:'unassigned',label:'Unassigned',description:'Not classified yet'}
].map(option=>Object.freeze(option));

export const ATTENDANCE_GROUP_OPTIONS=Object.freeze(options);

export const ATTENDANCE_GROUP_LABELS=Object.freeze(
  Object.fromEntries(ATTENDANCE_GROUP_OPTIONS.filter(option=>option.value!=='unassigned').map(({value,label})=>[value,label]))
);

export const ATTENDANCE_GROUP_FILTERS=Object.freeze([
  Object.freeze({value:'all',label:'All'}),
  ...ATTENDANCE_GROUP_OPTIONS.map(({value,label})=>Object.freeze({value,label}))
]);

export const attendanceGroupLabel=value=>
  ATTENDANCE_GROUP_FILTERS.find(option=>option.value===value)?.label||'Unassigned';
