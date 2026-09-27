// scripts/critical-ui-regression.js
import{existsSync,readFileSync}from'node:fs';

const read=p=>readFileSync(p,'utf8');
const attendance=read('components/AttendanceModal.js');
const fieldMode=read('lib/attendanceFieldMode.js');
const layout=read('components/Layout.js');
const duplicateApi=read('pages/api/review/duplicate-action.js');
const home=read('pages/index.js');
const peoplePage=read('pages/people.js');
const personPage=read('pages/person/[id].js');
const peopleApi=read('pages/api/people.js');
const peopleSizing=read('styles/people-sizing.css');
const reviewCenter=read('components/ReviewCenterTab.js');
const appPage=read('pages/_app.js');
const errorBoundary=read('components/ClientErrorBoundary.js');
const attendanceModal=read('components/AttendanceModal.js');
const environment=read('components/NyeoEnvironment.js');
const draftEngine=read('lib/aria/draftEngine.js');
const profile=read('pages/profile.js');
const onboarding=read('components/OnboardingProvider.js');
const scanRecovery=read('components/ScanRecovery.js');
const autoSync=read('components/AriaAutoSync.js');
const fieldRuntime=read('components/FieldModeRuntime.js');
const serviceWorker=read('public/sw.js');
const documentPage=read('pages/_document.js');
const scanRecoverySurface=read('components/ScanRecovery.js');
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
const reviewResolveApi=read('pages/api/review/resolve.js');
const scanModal=read('components/ScanModal.js');
const scanProvider=read('lib/hybridScanProvider.js');
const activeApi=read('pages/api/attendance/active-session.js');
const attendanceCorrectionApi=read('pages/api/attendance/aria-correction.js');
const attendancePeopleApi=read('pages/api/attendance/people.js');
const closeApi=read('pages/api/attendance/close-session.js');
const createApi=read('pages/api/attendance/create-session.js');
const queueLib=read('lib/aria/attendanceQueue.js');
const intelligence=read('lib/aria/attendanceIntelligence.js');
const director=read('lib/aria/director.js');
const eventProcessor=read('lib/aria/eventProcessor.js');
const briefing=read('pages/api/daily-briefing/latest.js');
const dailyQueue=read('lib/dailyQueue.js');
const dailyQueueDefer=read('pages/api/daily-queue/defer.js');
const dailyQueueMigration=read('supabase/migrations/20260927060000_add_aria_daily_queue.sql');
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
  /INSERT INTO sessions\(/.test(createApi)&&/event_kind/.test(createApi)&&/event_semantics/.test(createApi)&&/background_processing_not_blocking:true/.test(createApi)],
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
 ['Attendance discard is idempotent and closes stale UI',
  /clearFieldSession\(s\.user\.id,session\.session_id\)/.test(attendance)&&/onClose\(\)/.test(attendance)&&/\[404,409\]/.test(attendance)],
 ['Attendance Field Mode distinguishes local writes from syncs',
  /emit\('local'/.test(fieldMode)&&/emit\('sync'/.test(fieldMode)&&/kind==='sync'/.test(attendance)&&/kind==='clear'/.test(attendance)],
 ['Attendance live refresh is reduced to a 30s state check',
  /setInterval\(\(\)=>\{/.test(attendance)&&/30000/.test(attendance)&&/refreshSessionState\(\)/.test(attendance)],
 ['Attendance live updates are scoped to the current session',
  /filter:'id=eq\.'\+sessionId/.test(attendance)&&/filter:'session_id=eq\.'\+sessionId/.test(attendance)],
 ['Attendance roster warming is not repeated on every refresh',
  /fieldWarmAt=useRef/.test(attendance)&&/Date\.now\(\)-fieldWarmAt\.current<300000/.test(attendance)],

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
 ['Home cleanup has no stale prefetch timer references',
  !/cancelIdleCallback\(idle\)/.test(home)&&!/clearTimeout\(fallback\)/.test(home)],
 ['People does not initialize ARIA on page open',
  !peoplePage.includes('/api/aria/initialize')],
 ['Profile uses one bootstrap request',
  /api\/profile\/bootstrap/.test(profile)],
 ['Onboarding deduplicates in-flight loads',
  /inflight\.has\(key\)/.test(onboarding)],
 ['Scan recovery avoids historical-job scans',
  /stage!==\'processing\'/.test(scanRecovery)&&!/latest=1/.test(scanRecovery)],
 ['ARIA auto-sync is not startup-critical',
  /IDLE_DELAY=30000/.test(autoSync)&&/COOLDOWN=60000/.test(autoSync)&&/document\.visibilityState/.test(autoSync)],
 ['Home defers heavy interaction surfaces',/const ScanModal=dynamic/.test(home)&&/const AttendanceModal=dynamic/.test(home)&&/const ReviewCenterTab=dynamic/.test(home)],
 ['Navigation prefetches routes centrally during idle time',/requestIdleCallback/.test(layout)&&/r\.prefetch\('\/'\)/.test(layout)&&/r\.prefetch\('\/people'\)/.test(layout)&&/r\.prefetch\('\/profile'\)/.test(layout)&&!/router\.prefetch\('\/people'\)/.test(home)],
 ['People enhancer is not globally mounted',
  !/PeopleSurfaceEnhancer/.test(app)],
 ['People roster does not read browser storage during the render phase',
  /useState\(\(\)=>new Set\(\)\)/.test(peoplePage)&&/localStorage\.getItem\('nyeocare:seen-scan-cards:v1'\)/.test(peoplePage)],
 ['People restores the previous scroll position after a person journey',
  /PEOPLE_SCROLL_KEY/.test(peoplePage)&&/sessionStorage\.setItem\(PEOPLE_SCROLL_KEY/.test(peoplePage)&&/window\.scrollTo\(0,y\)/.test(peoplePage)],
 ['Person Journey returns to an explicit safe source location with history fallback',
  /return_to/.test(personPage)&&/safeReturnTo/.test(personPage)&&/window\.history\.length>1/.test(personPage)&&/r\.push\(['\"]\/people['\"]\)/.test(personPage)],
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

 ['Navigation does not force React rerender for route progress',
  /progressRef=useRef/.test(layout)&&/ref=\{progressRef\}/.test(layout)&&!/,\[navigating,setNavigating\]=useState/.test(layout)],
 ['Navigation does not force smooth scrolling',
  /html\{scroll-behavior:auto\}/.test(layout)&&!layout.includes('scroll-behavior:smooth')],
 ['Mobile navigation disables expensive continuous effects',
  /\.liquidNav g\{filter:none!important\}/.test(layout)&&/\.navGlass\{animation:none!important;will-change:auto\}/.test(layout)&&/\.livingCanvas::before\{animation:none!important\}/.test(layout)],
 ['Duplicate merge consolidates overlapping attendance history before moving identities',
  /mergeAttendanceHistory/.test(duplicateApi)&&/attendance_records/.test(duplicateApi)&&/present=\(COALESCE\(c\.present,false\) OR COALESCE\(d\.present,false\)\)/.test(duplicateApi)],
 ['Duplicate merge never exposes raw database constraint errors',
  !/Could not safely move .*history:\$\{err\.message\}/.test(duplicateApi)&&/Nothing was changed\./.test(duplicateApi)],
 ['Duplicate detector respects different given names with a shared surname',
  /function surnameGuard/.test(read('lib/duplicateDetector.js'))&&/differentGivenSameSurname/.test(read('lib/duplicateDetector.js'))&&/ps\.score<90/.test(read('lib/duplicateDetector.js'))],

 ['Review Center uses plain user-facing identity language',
  /duplicates:\{title:'Duplicates',tag:'PEOPLE'/.test(reviewCenter)&&/POSSIBLE DUPLICATE/.test(reviewCenter)&&!/DATABASE DUPLICATE/.test(reviewCenter)],
 ['Review detail back stays inside the queue',
  /function backToQueue\(\)/.test(reviewCenter)&&/__nyeocareReviewDetail/.test(reviewCenter)&&/popstate/.test(reviewCenter)&&/Review queue/.test(reviewCenter)&&/function finish\(\)\{backToQueue\(\)\}/.test(reviewCenter)],
 ['Client error boundary resets when the route changes and can recover globally',
  /ClientErrorBoundary key=\{router\.asPath\} resetKey=\{router\.asPath\}/.test(appPage)&&/componentDidMount\(\)/.test(errorBoundary)&&/nyeocare:app-refresh/.test(errorBoundary)],
 ['Navigation automatically recovers stale Next.js chunks once',
  /routeChangeError/.test(appPage)&&/ChunkLoadError|Loading chunk|dynamically imported module/.test(appPage)&&/sessionStorage/.test(appPage)&&/window\.location\.reload\(\)/.test(appPage)],
 ['Early document layer recovers stale client chunks before React mounts',
  /EARLY_RECOVERY_SCRIPT/.test(documentPage)&&/window\.addEventListener\('error'/.test(documentPage)&&/unhandledrejection/.test(documentPage)&&/early-client-recovery:v1/.test(documentPage)&&/location\.replace/.test(documentPage)],
 ['Scan recovery cannot make scan module loading part of the global shell',
  /dynamic\(\(\)=>import\('\.\/ScanModal'\)/.test(scanRecoverySurface)&&!/import ScanModal from/.test(scanRecoverySurface)],
 ['People optional browser observers cannot crash the page',
  /typeof IntersectionObserver==='undefined'/.test(peoplePage)&&/new IntersectionObserver/.test(peoplePage)],
 ['People review and birthday surfaces are lazy-loaded',
  /const ReviewCenterTab=dynamic/.test(peoplePage)&&/import\('\.\.\/components\/ReviewCenterTab'/.test(peoplePage)&&/const BirthdayPicker=dynamic/.test(peoplePage)&&/import\('\.\.\/components\/BirthdayPicker'/.test(peoplePage)],
 ['Non-critical root runtimes are individually isolated',
  /surface="environment-runtime"/.test(appPage)&&/surface="auth-runtime"/.test(appPage)&&/surface="aria-sync-runtime"/.test(appPage)&&/surface="scan-recovery-runtime"/.test(appPage)&&/surface="field-mode-runtime"/.test(appPage)&&/dynamic\(\(\)=>import\('\.\.\/components\/ScanRecovery'\)/.test(appPage)],
 ['Attendance never treats online local cache as authoritative',
  /hydrateFieldSession=useCallback\(async\(userId,\{allowLocalSession=false\}=\{\}\)/.test(attendanceModal)&&/allowLocalSession:offline/.test(attendanceModal)&&/if\(offline\)\{/.test(attendanceModal)&&/fieldCached&&fieldCached\.session\?\.status==='active'/.test(attendanceModal)],
 ['Global app runtime revalidates auth/data invisibly',
  /getClientSession/.test(fieldRuntime)&&/nyeocare:app-refresh/.test(fieldRuntime)&&/pageshow/.test(fieldRuntime)&&/setInterval\(run,60000\)/.test(fieldRuntime)],
 ['Service worker cache rotates with the client recovery release',
  /nyeocare-static-v4/.test(serviceWorker)&&/self\.skipWaiting\(\)/.test(serviceWorker)&&/self\.clients\.claim\(\)/.test(serviceWorker)],
['Environment weather state cannot crash the app',
  /const WEATHER_KEY='nyeocare:weather:v2'/.test(environment)&&/let weatherInFlight=false/.test(environment)&&/const run=\(\)=>\{try\{getWeather\(\)/.test(environment)],
 ['ARIA care draft initializes phone before database metadata insert',
  /rawPhone=person\.phone/.test(draftEngine)&&!/INSERT INTO person_communications[\\s\\S]{0,1200}const rawPhone=/.test(draftEngine)],
 ['ARIA launcher is isolated from page-wide client failures',
  /ClientErrorBoundary surface="aria-launcher"/.test(layout)&&/fallback=\{null\}/.test(layout)],

 ['Daily briefing is a per-operator compressed queue',/getDailyQueue/.test(briefing)&&/capacityPerOperator:5/.test(briefing)&&/laterCount/.test(briefing)&&/aria_daily_queue_items/.test(dailyQueue)],
 ['Daily queue distributes work across active owner/admin operators',/role IN\('owner','admin'\)/.test(dailyQueue)&&/DAY_CAPACITY=5/.test(dailyQueue)&&/HORIZON_DAYS=31/.test(dailyQueue)],
 ['Daily queue defers work without rejecting the underlying ARIA action',/deferDailyQueueItem/.test(dailyQueueDefer)&&/queue_date/.test(dailyQueueDefer)&&/\/api\/daily-queue\/defer/.test(scanModal)===false&&/\/api\/daily-queue\/defer/.test(read('pages/index.js'))],
 ['Daily queue has durable one-source scheduling',/UNIQUE \(organization_id, task_kind, source_id\)/.test(dailyQueueMigration)],
 ['Review Center excludes attendance follow-ups',/pending_count:scanItems\.length\+groups\.length/.test(reviewApi)&&!/attendanceItems/.test(reviewApi)],
 ['Daily briefing makes scan review a canonical grouped item',
  /scan_review_items/.test(dailyQueue)&&/task_kind:'scan_review'/.test(dailyQueue)&&/category:'scan'/.test(dailyQueue)],
 ['Auth caches bearer verification',
  /AUTH_TTL=2500/.test(auth)],
 ['Review identity actions are explicit and correction-first',/Use this person/.test(reviewCenter)&&/This is a different person/.test(reviewCenter)&&/Edit scanned record/.test(reviewCenter)&&/Selected:/.test(reviewCenter)],
 ['Review Center supports audited bulk dismissal of selected scan reviews',/bulk_dismissed/.test(reviewResolveApi)&&/status='rejected'/.test(reviewResolveApi)&&/id=ANY\(\$4::uuid\[\]\)/.test(reviewResolveApi)&&/selected_count/.test(reviewResolveApi)],
 ['Review Center supports long-press scan selection only for scan reviews',/onPointerDown/.test(reviewCenter)&&/setTimeout\(\(\)=>beginSelection/.test(reviewCenter)&&/item\.kind==='scan_identity_review'/.test(reviewCenter)&&/bulkDismiss/.test(reviewCenter)],
 ['Camera and gallery scans preserve supported source-image detail',/async function prepare\(file\)/.test(scanModal)&&scanModal.includes('^image')&&scanModal.includes('(jpeg|jpg|png|webp)')&&/MAX=4000000/.test(scanModal)&&/withTimeout/.test(scanModal)&&/SCAN_IMAGE_DECODE_TIMEOUT/.test(scanModal)&&/SCAN_IMAGE_ENCODE_TIMEOUT/.test(scanModal)&&/3000/.test(scanModal)&&!/timeoutError/.test(scanModal)],
 ['Camera and gallery both call the same scan starter after preparation',/onChange=\{pick\}/.test(scanModal)&&/const pick=e=>/.test(scanModal)&&/if\(f\)start\(f\)/.test(scanModal)&&/const image_base64=await prepare\(file\)/.test(scanModal)],
 ['Scan extraction uses the proven overlapping-region pipeline',
  /v65-hybrid-multiregion-crosscheck-revived/.test(scanProvider)&&/regions=await makeRegions/.test(scanProvider)&&/Math\.round\(H\*\.62\)/.test(scanProvider)&&/normalize\(\)\.sharpen/.test(scanProvider)&&/reasoning_effort:'high'/.test(scanProvider)&&/cross_checking/.test(scanProvider)],
 ['Scan extraction performs conservative independent cross-checking when configured',
  /GEMINI_API_KEY/.test(scanProvider)&&/geminiCrosscheck/.test(scanProvider)&&/flagDisagreements/.test(scanProvider)&&/row_ownership_uncertain/.test(scanProvider)],
 ['People roster silently refreshes expired auth sessions',
  /if\(res\.status===401\)/.test(peoplePage)&&/refreshClientSession\(\)/.test(peoplePage)&&/setAccessToken\(activeToken\)/.test(peoplePage)],
 ['Person editing preserves the displayed honorific/prefix',/setEditName\(p\.display_name\|\|/.test(personPage)],
 ['People API preserves an existing honorific when an edit omits it',/existing=normalizeDisplayName\(check\.rows\[0\]\.display_name/.test(peopleApi)&&/existing\.honorific&&!parsed\.honorific/.test(peopleApi)],
 ['People roster API projects canonical last_seen from engagement metrics',/em\.last_seen/.test(peopleApi)&&/AS last_seen/.test(peopleApi)&&/SELECT r\.id,/.test(peopleApi)&&/r\.last_seen/.test(peopleApi)],
 ['People cards render last_seen instead of silently falling back to last attended',/const formatLastSeen=/.test(peoplePage)&&/Last seen ·/.test(peoplePage)&&/formatLastSeen\(person\.last_seen\|\|person\.last_seen_at\)/.test(peoplePage)&&!/formatLastAttended\(/.test(peoplePage)],
 ['People roster Last seen is month/day only',/const formatLastSeen=/.test(peoplePage)&&/Intl\.DateTimeFormat\('en-NG',\{month:'short',day:'numeric',timeZone:'Africa\/Lagos'\}\)/.test(peoplePage)&&!/d\.getFullYear\(\)/.test(peoplePage)],
 ['People last_seen row cannot be hidden by icon-structure CSS',/className="ny-last-seen"/.test(peoplePage)&&/className="ny-phone-row"/.test(peoplePage)&&/\.ny-last-seen\{display:flex!important/.test(peopleSizing)&&/\.ny-phone-row\{display:flex!important/.test(peopleSizing)&&!/:has\(>svg rect\[x="3"\]\[y="4"\]/.test(peopleSizing)],
 ['People last_seen is displayed even when only canonical attendance fallback exists',/person\.last_seen\|\|person\.last_seen_at/.test(peoplePage)&&/AS last_seen/.test(peopleApi)],
 ['Person Journey exposes canonical last attendance and last interaction',
  /last_attendance_at/.test(personPage)&&/last_interaction_at/.test(personPage)&&/Last attendance/.test(personPage)&&/Last interaction/.test(personPage)],
 ['ARIA attendance correction is human-confirmed and durable',
  /withAdmin/.test(attendanceCorrectionApi)&&/present/.test(attendanceCorrectionApi)&&/participation_records/.test(attendanceCorrectionApi)&&/aria_attendance_contexts/.test(attendanceCorrectionApi)&&/enqueueAttendanceProcessing/.test(attendanceCorrectionApi)&&/stage:'persist'/.test(attendanceCorrectionApi)&&/processing_pending:true/.test(attendanceCorrectionApi)],
 ['ARIA attendance correction never holds a DB connection for derived intelligence',
  !/updateEngagementMetricsForPerson/.test(attendanceCorrectionApi)&&!/computeRelationshipScore/.test(attendanceCorrectionApi)&&!/updatePeopleIntelligence/.test(attendanceCorrectionApi)&&!/updatePersonState/.test(attendanceCorrectionApi)&&!/createCareDraft/.test(attendanceCorrectionApi)],
 ['Tell ARIA attendance correction keeps the user path non-blocking',
  /\/api\/attendance\/aria-correction/.test(home)&&/d\.processing_pending/.test(home)],

 ['Review has lightweight summary path',
  /req\.query\?\.summary===\'1\'/.test(reviewApi)],
 ['Daily briefing endpoint remains read-only',
  !/INSERT INTO aria_actions/.test(briefing)],
 ['ARIA director remains available',
  /ARIA_DIRECTOR_VERSION/.test(director)&&/directAriaEvent/.test(director)],
 ['Event processor remains durable',
  /createObservation\(/.test(eventProcessor)&&/sourceEventId:event\.id/.test(eventProcessor)]
];

const failures=checks.filter(([,ok])=>!ok).map(([name])=>name);
if(failures.length){
 console.error('[CRITICAL UI] Canonical attendance/scalability regression guard failed.');
 console.error(failures.join(' | '));
 process.exit(1);
}

console.log('[CRITICAL UI] Canonical attendance/scalability regression guards passed.');
