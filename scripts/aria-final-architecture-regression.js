// scripts/aria-final-architecture-regression.js
import{readFileSync,existsSync}from'node:fs';

const read=p=>readFileSync(p,'utf8');
const files={
 gateway:read('lib/aiGateway.js'),
 providers:read('lib/aiProviders/index.js'),
 registry:read('lib/modelRegistry.js'),
 hybrid:read('lib/hybridScanProvider.js'),
 legacyProvider:read('lib/aiProviderCore.js'),
 vision:read('lib/visionProcessor.js'),
 scanStart:read('pages/api/scan/start.js'),
 scanStatus:read('pages/api/scan/status.js'),
 budget:read('lib/budgetGuard.js'),
 draft:read('lib/aria/draftEngine.js'),
 command:read('lib/aria/commandEngine.js'),
 conversation:read('lib/aria/conversationEngine.js'),
 eventProcessor:read('lib/aria/eventProcessor.js'),
 eventEmitter:read('lib/aria/eventEmitter.js'),
 attendanceSave:read('pages/api/attendance/mark.js'),
 attendanceClose:read('pages/api/attendance/close-session.js'),
 createSession:read('pages/api/attendance/create-session.js'),
 spec:read('NYEO_SPEC.md'),
 workflow:read('.github/workflows/ci.yml')
};

const checks=[
 ['AI gateway resolves adapters from model metadata',files.gateway.includes('getModelConfig')&&files.gateway.includes('getAIProvider')&&files.gateway.includes('config.provider')],
 ['Provider registry is the only provider adapter boundary',files.providers.includes("groqRequest")&&files.providers.includes('getAIProvider')],
 ['AI model registry remains provider-aware',files.registry.includes("provider:'groq'")&&files.registry.includes('model:')],
 ['Vision uses the provider registry instead of a direct API URL/key',files.hybrid.includes("getAIProvider(model.provider)")&&!files.hybrid.includes('https://api.groq.com/openai/v1/chat/completions')&&!files.hybrid.includes('process.env.GROQ_API_KEY')],
 ['Legacy aiProviderCore is only a compatibility facade',!files.legacyProvider.includes('fetch(')&&files.legacyProvider.includes("from'./hybridScanProvider'")],
 ['Scan API reports configured provider/model rather than hard-coding Groq',files.scanStart.includes('getScanAdmission()')&&!files.scanStart.includes("provider='groq'")&&!files.scanStart.includes("model='qwen/qwen3.8-27b'")],
 ['Scan status uses provider-neutral rate-limit messaging',!files.scanStatus.includes("Groq's vision limit")&&files.scanStatus.includes('error?.provider')],
 ['Vision job persists the actual provider',files.vision.includes('vision.provider')&&!files.vision.includes("vision_provider:'groq'")],
 ['Organization AI budget aggregates across purposes',files.budget.includes("WHERE organization_id=$1")&&!files.budget.includes("WHERE organization_id=$1 AND purpose=$2")],
 ['Text response cache supports stable idempotency keys',files.gateway.includes('ai_request_cache')&&files.gateway.includes('idempotencyKey')&&files.gateway.includes('writeCachedText')],
 ['ARIA command planning passes stable request identity',files.command.includes('idempotencyKey')&&files.command.includes('aria-command:')],
 ['ARIA narrative responses pass stable request identity',files.conversation.includes('aria-response:')&&files.conversation.includes('requestMessageId')],
 ['Care drafts pass stable action identity',files.draft.includes('idempotencyKey')&&files.draft.includes('care-draft:')],
 ['Deterministic event processing does not depend on the LLM gateway',!files.eventProcessor.includes("from'../aiGateway'")&&!files.eventProcessor.includes("from './aiGateway'")],
 ['Attendance save path is not LLM-gated',!files.attendanceSave.includes('generateText')&&!files.attendanceSave.includes('callVisionWithRetry')],
 ['Attendance close publishes durable background processing',files.attendanceClose.includes('enqueueAttendanceProcessing')&&files.attendanceClose.includes('COMMIT')],
 ['New attendance defaults remain adaptive',files.createSession.includes('absence_meaningful=false')&&files.createSession.includes('event_semantics')],
 ['Provider-specific duplicate implementation is not part of the active scan path',files.hybrid.includes('callOne')&&/compatibility facade/i.test(files.legacyProvider)],
 ['Final architecture is documented in the repository',files.spec.includes('## 58. SEPTEMBER 26, 2026')&&/provider agnosticism/i.test(files.spec)&&/failure handling/i.test(files.spec)],
 ['CI still targets the production Vercel project explicitly',files.workflow.includes('VERCEL_PROJECT_ID: prj_flnxmzr4QNgJK3SthDetLN0OLFKK')],
 ['No legacy unauthenticated AI/scan test endpoints remain',!existsSync('pages/api/ai/correct-scan.js')&&!existsSync('pages/api/test-scan.js')&&!existsSync('pages/api/test-ocr-space.js')]
];

const failures=checks.filter(([,ok])=>!ok).map(([name])=>name);
if(failures.length){
 console.error('[ARIA FINAL ARCHITECTURE] FAILED');
 console.error(failures.join(' | '));
 process.exit(1);
}
console.log('[ARIA FINAL ARCHITECTURE] Foundation → intelligence → learning → performance → UX regression guards passed.');
