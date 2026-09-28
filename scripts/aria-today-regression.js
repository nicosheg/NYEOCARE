import{readFileSync}from'node:fs';

const read=p=>readFileSync(p,'utf8');
const failures=[];
const expect=(condition,message)=>{if(!condition)failures.push(message)};

const queue=read('lib/dailyQueue.js');
const home=read('pages/api/home/bootstrap.js');
const index=read('pages/index.js');
const attendanceContext=read('pages/api/attendance/context.js');
const careQueue=read('pages/api/care-queue.js');
const attendanceCorrection=read('pages/api/attendance/aria-correction.js');
const capabilityRegistry=read('lib/aria/capabilityRegistry.js');
const capabilityEngine=read('lib/aria/capabilityEngine.js');
const command=read('lib/aria/commandEngine.js');
const conversation=read('lib/aria/conversationEngine.js');
const state=read('lib/aria/conversationState.js');
const profile=read('pages/profile.js');
const ariaPage=read('pages/aria.js');
const peopleMutation=read('lib/aria/peopleMutationEngine.js');
const peopleParser=read('lib/aria/peopleRosterParser.js');

expect(queue.includes("m?.kind==='attendance_absence_check_in'||m?.kind==='returned_after_absence'?'follow_up':'action'"),'Attendance absence actions must be canonical follow-up queue items.');
expect(queue.includes("task_kind:first?'follow_up':'action'"),'UNUSUAL_ABSENCE observations must be canonical follow-up queue items.');
expect(home.includes("getDailyQueue(orgId,req.user.id)"),'Home must consume the canonical Daily Queue.');
expect(home.includes("queue:{todayCount:count,laterCount:Number(dailyQueue.later_count)||0,items:top}"),'Home must expose canonical queue state.');
expect(index.includes("item?.task_kind==='follow_up'"),'Briefing UI must group from canonical task_kind.');
expect(index.includes("observation_id:item.observation_id||null"),'Attendance correction must preserve the linked observation.');
expect(index.includes("disabled={busy||!note.trim()} onClick={saveContext}"),'Attendance Tell ARIA must have an explicit submit action.');
expect(attendanceContext.includes("resolveCareWorkInTransaction"),'Attendance context must resolve the canonical care state atomically.');
expect(careQueue.includes("resolveCareWorkInTransaction"),'Care context must resolve the canonical care state atomically.');
expect(attendanceCorrection.includes("resolveCareWorkInTransaction"),'Attendance correction must resolve linked observations/actions.');
expect(capabilityRegistry.includes("import_people_roster"),'ARIA must register People roster import capability.');
expect(capabilityRegistry.includes("update_person_record"),'ARIA must register People update capability.');
expect(capabilityEngine.includes("importPeopleRoster"),'Capability engine must execute People roster imports.');
expect(capabilityEngine.includes("updatePersonRecord"),'Capability engine must execute confirmed People updates.');
expect(command.includes("goal:'import_people_roster'"),'Command planner must recognize roster imports.');
expect(command.includes("type:'person_update_confirmation'"),'Command planner must require confirmation before person mutations.');
expect(conversation.includes("resolvePendingPersonUpdate"),'Conversation engine must resolve pending person updates.');
expect(conversation.includes("parsePeopleRoster(input)"),'Conversation engine must recognize pasted rosters directly.');
expect(state.includes("pending_person_update"),'Conversation state must persist pending person update confirmation.');
expect(!profile.includes('ARIA guidance'), 'Profile must not contain the duplicate ARIA guidance surface.');
expect(!profile.includes('ariaInstructions'), 'Profile must not edit ARIA guidance through its save path.');
expect(!profile.includes('setAria'), 'Profile must not retain ARIA guidance state.');
expect(!profile.includes('ariaLaunchButton'), 'Profile must not contain a duplicate Tell ARIA launcher.');
expect(command.includes("capability_overview"),'ARIA command planning must have a dynamic capability-awareness path.');
expect(command.includes("people_import_request"),'ARIA must recognize explicit intent to add/import People before generic planning.');
expect(capabilityRegistry.includes("requiredRole:'owner_or_admin'"),'Capability registry must expose role boundaries to ARIA.');
expect(capabilityRegistry.includes("import_people_roster:{description:"),'People roster import must remain an explicitly registered capability.');

expect(command.includes("listCapabilitiesForRole"),'ARIA command planning must use the authoritative capability catalog.');
expect(conversation.includes("inferPeopleRosterIntent"),'Conversation engine must use semantic roster intent, including packed input.');
expect(conversation.includes("const OBSERVATION_FOLLOW_UP=/^"),'Observation follow-up matching must be anchored to prevent sentence-level false positives.');
expect(conversation.includes("CAPABILITY AWARENESS AND RECOVERY"),'Natural ARIA responses must include capability-aware recovery guidance.');
expect(!ariaPage.includes("onKeyDown={e=>{if(e.key==='Enter'"),'Tell ARIA must not send on Enter.');
expect(ariaPage.includes('type="button" onClick={()=>send()}'), 'Tell ARIA Send must be an explicit button action.');
expect(ariaPage.includes("resizeComposer"),'Tell ARIA composer must auto-expand for pasted/multiline input.');
expect(ariaPage.includes('max-height:180px'),'Tell ARIA composer must support expanded multiline input.');
expect(ariaPage.includes('.message.user>div{white-space:pre-wrap'), 'User messages must preserve pasted line breaks visually.');

expect(peopleParser.includes('export function parsePeopleRoster'),'People parser must be independently testable.');
expect(peopleMutation.includes("from'./peopleRosterParser'"),'People mutation engine must use the isolated roster parser.');

console.log('[ARIA TODAY REGRESSION]');
console.log('Canonical queue, Tell ARIA resolution, People import/update and Profile launcher checks.');
console.log('High-confidence failures:',failures.length);
for(const failure of failures)console.error('FAIL:',failure);
if(failures.length)process.exit(1);
console.log('PASS: canonical ARIA Today contracts are present.');
