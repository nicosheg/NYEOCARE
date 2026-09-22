// scripts/critical-ui-regression.js
import{existsSync,readFileSync}from'node:fs';

const read=p=>readFileSync(p,'utf8');
const attendance=read('components/AttendanceModal.js');
const home=read('pages/index.js');
const peoplePage=read('pages/people.js');
const personPage=read('pages/person/[id].js');
const peopleApi=read('pages/api/people.js');
const reviewCenter=read('components/ReviewCenterTab.js');
const profile=read('pages/profile.js');
const onboarding=read('components/OnboardingProvider.js');
const scanRecovery=read('components/ScanRecovery.js');
const autoSync=read('components/AriaAutoSync.js');
const ariaLauncher=read('components/AriaCommandCenter.js');
const ariaPage=read('pages/aria.js');
const aiGateway=read('lib/aiGateway.js');
const ariaConversation=read('lib/aria/conversationEngine.js');
const ariaCommand=read('lib/aria/commandEngine.js');
const ariaRecommendation=read('lib/aria/recommendationEngine.js');
const ariaDraft=read('lib/aria/draftEngine.js');
const app=read('pages/_app.js');
const db=read('lib/db.js');
const auth=read('lib/auth.js');
const reviewApi=read('pages/api/review/index.js');
const activeApi=read('pages/api/attendance/active-session.js');
const attendancePeopleApi=read('pages/api/attendance/people.js');
const closeApi=read('pages/api/attendance/close-session.js');
const createApi=read('pages/api/attendance/create-session.js');
const queueLib=read('lib/aria/attendanceQueue.js');
const intelligence=read('lib/aria/attendanceIntelligence.js');
const director=read('lib/aria/director.js');
const eventProcessor=read('lib/aria/eventProcessor.js');
const briefing=read('pages/api/daily-briefing/latest.js');
const homeBootstrap=read('pages/api/home/bootstrap.js');
const durableMigration=read('supabase/migrations/20260920154000_durable_attendance_processing.sql');
const recoveryMigration=read('supabase/migrations/20260920154500_harden_attendance_queue_recovery.sql');
const backgroundIndexMigration=read('supabase/migrations/20260920154800_include_needs_attention_in_background_session_index.sql');
const parallelMigration=read('supabase/migrations/20260920160000_parallelize_durable_attendance_workers.sql');
const pkg=JSON.parse(read('package.json'));
const vercel=JSON.parse(read('vercel.json'));

const checks=[
 ['Attendance session state separates live work from background ARIA',
  /s\.status='active'/.test(activeApi)&&/background_processing/.test(activeApi)&&/can_start_new_session:true/.test(activeApi)],
 ['Attendance close is atomic with durable queue publication',
  /BEGIN/.test(closeApi)&&/COMMIT/.test(closeApi)&&/enqueueAttendanceProcessing/.test(closeApi)&&/db:client/.test(closeApi)],
 ['Attendance close never waits for ARIA',
  !closeApi.includes('waitUntil')&&!closeApi.includes('processAttendanceSession')],
 ['New attendance does not wait for previous ARIA processing',
  createApi.includes("VALUES($1,$2,'active',$3,NOW(),'idle','idle'")],
 ['Attendance close resets processing state',
  /aria_processing_attempts=0/.test(closeApi)&&/aria_processing_stage='persist'/.test(closeApi)],
 ['Attendance roster is bounded and cursor-paginated',
  /limit=Math\.min/.test(attendancePeopleApi)&&/next_cursor/.test(attendancePeopleApi)&&/base64url/.test(attendancePeopleApi)],
 ['Attendance roster search stays server-side',
  /ILIKE '%'\|\|\$/.test(attendancePeopleApi)&&/COALESCE\(p\.phone/.test(attendancePeopleApi)],
 ['Attendance UI loads pages instead of the whole organization',
  /limit:'80'/.test(attendance)&&/loadMore/.test(attendance)],
 ['Attendance UI shows background ARIA without blocking live attendance',
  /background_processing/.test(attendance)&&(/You can start the next attendance now/.test(attendance)||/You can start the next session while ARIA finishes this one/.test(attendance))],
 ['Attendance UI has no ARIA retry action',
  !attendance.includes('Retry processing')&&!attendance.includes('retry processing')],
 ['Home shows ARIA progress as background state',
  /aria_processing/.test(homeBootstrap)&&/AriaProcessingStatus/.test(home)&&/ariaAttendance/.test(home)],
 ['Home has no attendance retry action',
  !home.includes('Open Attendance to retry processing')&&!home.includes('ARIA needs attention on your latest attendance')],
 ['Durable queue uses Supabase PGMQ',
  /pgmq\.send/.test(queueLib)&&/nyeocare-attendance/.test(queueLib)],
 ['Durable worker is defined in SQL',
  /nyeocare_process_attendance_queue/.test(durableMigration)&&/pgmq\.read/.test(durableMigration)],
 ['Attendance stages are set-based',
  /INSERT INTO public\.participation_records/.test(durableMigration)&&/INSERT INTO public\.engagement_metrics/.test(durableMigration)&&/INSERT INTO public\.relationship_scores/.test(durableMigration)&&/INSERT INTO public\.people_intelligence/.test(durableMigration)&&/INSERT INTO public\.aria_person_state/.test(durableMigration)],
 ['Attendance processing has bounded automatic recovery',
  /v_attempt>=8/.test(recoveryMigration)&&/needs_attention/.test(recoveryMigration)&&/pgmq\.set_vt/.test(recoveryMigration)],
 ['Attendance workers parallelize safely by session',
  /pg_try_advisory_xact_lock\(hashtextextended\(v_session::text/.test(parallelMigration)&&/worker-1/.test(parallelMigration)===false&&/generate_series\(1,4\)/.test(parallelMigration)],
 ['Legacy Vercel attendance worker is removed',
  !existsSync('pages/api/queue/attendance-process.js')&&!existsSync('pages/api/attendance/process-session.js')&&!pkg.dependencies?.['@vercel/queue']],
 ['Vercel has no legacy attendance queue trigger',
  !vercel.functions?.['pages/api/queue/attendance-process.js']],
 ['No N-person ARIA fanout remains in canonical intelligence module',
  !intelligence.includes('mapConcurrent')&&!intelligence.includes('processAriaEvent')],
 ['Absence requires prior confirmed evidence',
  /prior_84>=2/.test(durableMigration)&&/prior_28>=1/.test(durableMigration)],
 ['Attendance intelligence does not invent absence causes',
  /does not know the reason for the absence/.test(durableMigration)],
 ['Attendance background state is indexed',
  /sessions_org_background_processing_idx/.test(durableMigration)&&/sessions_org_background_processing_idx/.test(backgroundIndexMigration)&&/needs_attention/.test(backgroundIndexMigration)],
 ['Serverless DB pool remains bounded',
  /max:1/.test(db)||/max:4/.test(db)],
 ['Serverless DB pool is attached',
  /attachDatabasePool\(pool\)/.test(db)],
 ['Home coalesces bootstrap loads',
  /loadPromiseRef\.current/.test(home)],
 ['People does not initialize ARIA on page open',
  !peoplePage.includes('/api/aria/initialize')],
 ['Profile uses one bootstrap request',
  /api\/profile\/bootstrap/.test(profile)],
 ['Onboarding deduplicates in-flight loads',
  /inflight\.has\(key\)/.test(onboarding)],
 ['Scan recovery avoids historical-job scans',
  /stage!==\'processing\'/.test(scanRecovery)&&!/latest=1/.test(scanRecovery)],
 ['ARIA auto-sync is not startup-critical',
  /IDLE_DELAY=15000/.test(autoSync)&&/document\.visibilityState/.test(autoSync)],
 ['People enhancer is not globally mounted',
  !/PeopleSurfaceEnhancer/.test(app)],
 ['People roster cards are painted immediately instead of deferred on scroll',
  !/content-visibility:auto/.test(peoplePage)&&/peopleSoftBreeze/.test(peoplePage)&&/\.pagePeople \\.person-card\{backdrop-filter:none/.test(peoplePage)],
 ['People restores the previous scroll position after a person journey',
  /PEOPLE_SCROLL_KEY/.test(peoplePage)&&/sessionStorage\.setItem\(PEOPLE_SCROLL_KEY/.test(peoplePage)&&/window\.scrollTo\(0,y\)/.test(peoplePage)],
 ['Journey back uses browser history so the People location can be restored',
  /onClick=\{\(\)=>r\.back\(\)\}/.test(personPage)],
 ['ARIA launcher remains above application surfaces and interactive',
  /position:fixed;z-index:2147483000/.test(ariaLauncher)&&/pointer-events:auto/.test(ariaLauncher)&&/nyeocare:aria-open/.test(ariaLauncher)],
 ['ARIA welcome prompt controls are not covered by the empty thread layer',
  /thread.*passive/.test(ariaPage)&&/pointer-events:none/.test(ariaPage)&&/thread\.interactive\{pointer-events:auto\}/.test(ariaPage)],
 ['ARIA person finder results remain above the conversation stage',
  /\.context\{position:relative;z-index:20/.test(ariaPage)&&/\.matches\{position:absolute;z-index:1000/.test(ariaPage)],
 ['ARIA AI gateway exposes provider finish reasons',
  /finishReason/.test(aiGateway)&&/choice\?\.finish_reason/.test(aiGateway)],
 ['ARIA narrative responses use adaptive completion budgets and automatic continuation',
  /responseProfile\(message,result,history=\[\]\)/.test(ariaConversation)&&/mode:'concise',maxTokens:360/.test(ariaConversation)&&/mode:'decision',maxTokens:520/.test(ariaConversation)&&/mode:'deep',maxTokens:900/.test(ariaConversation)&&/finishReason==='length'/.test(ariaConversation)&&/aria_conversation_response_continuation/.test(ariaConversation)&&/attempt<2/.test(ariaConversation)],
 ['ARIA uses progressive disclosure for cognitive load',
  /Brevity is the default/.test(ariaConversation)&&/progressive disclosure/.test(ariaConversation)&&/small number of high-value signals/.test(ariaConversation)&&/Never use length to sound intelligent/.test(ariaConversation)],
 ['ARIA deterministic responses bypass unnecessary generation',
  /result\.type==='response'&&result\.text/.test(ariaConversation)],
 ['ARIA context summaries remain available as a complete fallback',
  /result\.type!=='completed'&&result\.type!=='conversation_context'/.test(ariaConversation)],
 ['ARIA narrative continuation exhaustion fails safely instead of persisting partial text',
  /if\(finishReason==='length'\)/.test(ariaConversation)&&/Please try that question again/.test(ariaConversation)&&/status:503/.test(ariaConversation)],
 ['ARIA state-changing conversation requests stop for human confirmation',
  /if\(capability\.approval\)/.test(ariaCommand)&&/type:'action_confirmation'/.test(ariaCommand)&&/requires_confirmation:true/.test(ariaCommand)&&/planActionFromObservation/.test(ariaCommand)],
 ['ARIA preserves a durable conversation-linked action proposal',
  /conversation_id:conversationId/.test(ariaCommand)&&/aria-chat:/.test(ariaCommand)&&/action_metadata->>'conversation_id'/.test(ariaConversation)&&/proposed_at>=NOW\(\)-INTERVAL '30 minutes'/.test(ariaConversation)],
 ['ARIA can confirm or decline a pending proposal naturally',
  /confirmationKind/.test(ariaConversation)&&/Understood\. I will not prepare it\./.test(ariaConversation)&&/approveAction\(action\.id/.test(ariaConversation)],
 ['ARIA confirmation prepares WhatsApp drafts only after approval',
  /approvedOnly:true/.test(ariaConversation)&&/createCareDraft/.test(ariaConversation)&&/type==='SEND_MESSAGE'/.test(ariaConversation)],
 ['ARIA restores pending action confirmation when conversations reopen',
  /pendingAction/.test(ariaPage)&&/setSuggestion\(pending\?/.test(ariaPage)&&/status:'awaiting_confirmation'/.test(ariaPage)&&/pendingAction/.test(ariaPage)],
 ['ARIA action approval is admin/owner constrained at the domain boundary',
  /u\.role IN\('owner','admin'\)/.test(ariaRecommendation)],
 ['ARIA approved-only drafting cannot bypass confirmation',
  /approvedOnly&&!actionId/.test(ariaDraft)],
 ['ARIA WhatsApp links normalize Nigerian local numbers',
  /startsWith\('234'\)/.test(ariaDraft)&&/startsWith\('0'\)&&digits\.length===11/.test(ariaDraft)],
 ['ARIA chat renders Markdown emphasis and lists',
  /function inlineMarkdown/.test(ariaPage)&&/MarkdownMessage/.test(ariaPage)&&/ariaMarkdown/.test(ariaPage)&&/m\.role==="assistant"\?/.test(ariaPage)],
 ['Home action row is intentionally lifted above the launcher baseline',
  /\.nyHomeTools\{position:relative;z-index:4;transform:translateY\(-12px\)\}/.test(home)],
 ['Auth caches bearer verification',
  /AUTH_TTL=2500/.test(auth)],
 ['Review identity actions prioritize correction before direct remembering',/Edit & remember/.test(reviewCenter)&&/Remember as read/.test(reviewCenter)&&reviewCenter.indexOf('Edit & remember')<reviewCenter.indexOf('Remember as read')],
 ['Person editing preserves the displayed honorific/prefix',/setEditName\(p\.display_name\|\|/.test(personPage)],
 ['People API preserves an existing honorific when an edit omits it',/existing=normalizeDisplayName\(check\.rows\[0\]\.display_name/.test(peopleApi)&&/existing\.honorific&&!parsed\.honorific/.test(peopleApi)],
 ['Review has lightweight summary path',
  /req\.query\?\.summary===\'1\'/.test(reviewApi)],
 ['Daily briefing endpoint remains read-only',
  !/INSERT INTO aria_actions/.test(briefing)],
 ['ARIA director remains available',
  /ARIA_DIRECTOR_VERSION/.test(director)&&/directAriaEvent/.test(director)],
 ['Event processor remains durable',
  /createObservation\(/.test(eventProcessor)&&/sourceEventId:eventId/.test(eventProcessor)]
];

const failures=checks.filter(([,ok])=>!ok).map(([name])=>name);
if(failures.length){
 console.error('[CRITICAL UI] Canonical attendance/scalability regression guard failed.');
 console.error(failures.join(' | '));
 process.exit(1);
}

console.log('[CRITICAL UI] Canonical attendance/scalability regression guards passed.');
