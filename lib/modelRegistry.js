// lib/modelRegistry.js
const REQUIRED=['provider','model','max_completion_tokens','input_cost_per_1k','output_cost_per_1k','version','effective_from','capabilities','supports_reasoning_effort','supports_json_object','supports_structured_output','estimated_input_tokens_per_scan','estimated_output_tokens_per_scan'];
function validate(key,c){
 for(const f of REQUIRED)if(!(f in c))throw new Error(`modelRegistry: ${key} missing ${f}`);
 if(typeof c.provider!=='string'||typeof c.model!=='string')throw new Error(`modelRegistry: ${key} provider/model invalid`);
 if(!Number.isInteger(c.max_completion_tokens)||c.max_completion_tokens<=0)throw new Error(`modelRegistry: ${key} max_completion_tokens invalid`);
 for(const f of['input_cost_per_1k','output_cost_per_1k'])if(typeof c[f]!=='number'||!Number.isFinite(c[f])||c[f]<0)throw new Error(`modelRegistry: ${key} ${f} invalid`);
 if(typeof c.version!=='string'||typeof c.effective_from!=='string'||!Array.isArray(c.capabilities))throw new Error(`modelRegistry: ${key} metadata invalid`);
 for(const f of['supports_reasoning_effort','supports_json_object','supports_structured_output'])if(typeof c[f]!=='boolean')throw new Error(`modelRegistry: ${key} ${f} invalid`);
 for(const f of['estimated_input_tokens_per_scan','estimated_output_tokens_per_scan'])if(!Number.isInteger(c[f])||c[f]<=0)throw new Error(`modelRegistry: ${key} ${f} invalid`);
}
const raw={
'groq-qwen3.8-27b':{provider:'groq',model:'qwen/qwen3.8-27b',max_completion_tokens:1600,input_cost_per_1k:.0008,output_cost_per_1k:.004,version:'2.3',effective_from:'2026-09-09',capabilities:['vision','text','json_mode','json_schema','reasoning','tool_use'],supports_reasoning_effort:true,supports_json_object:true,supports_structured_output:true,estimated_input_tokens_per_scan:2400,estimated_output_tokens_per_scan:800},
'groq-qwen3.6-27b':{provider:'groq',model:'qwen/qwen3.6-27b',max_completion_tokens:1600,input_cost_per_1k:.0006,output_cost_per_1k:.003,version:'2.3',effective_from:'2026-09-09',capabilities:['vision','text','json_mode','reasoning_control','tool_use'],supports_reasoning_effort:true,supports_json_object:true,supports_structured_output:false,estimated_input_tokens_per_scan:2400,estimated_output_tokens_per_scan:800},
'groq-whisper-large-v3-turbo':{provider:'groq',model:'whisper-large-v3-turbo',max_completion_tokens:1,input_cost_per_1k:0,output_cost_per_1k:0,version:'1.0',effective_from:'2026-09-04',capabilities:['transcription'],supports_reasoning_effort:false,supports_json_object:false,supports_structured_output:false,estimated_input_tokens_per_scan:1,estimated_output_tokens_per_scan:1},
'groq-orpheus-v1-english':{provider:'groq',model:'canopylabs/orpheus-v1-english',max_completion_tokens:1,input_cost_per_1k:0,output_cost_per_1k:0,version:'1.0',effective_from:'2026-09-04',capabilities:['speech'],supports_reasoning_effort:false,supports_json_object:false,supports_structured_output:false,estimated_input_tokens_per_scan:1,estimated_output_tokens_per_scan:1}
};
for(const[k,c]of Object.entries(raw))validate(k,c);
const registry={};for(const[k,c]of Object.entries(raw))registry[k]=Object.freeze({...c});
export const MODEL_REGISTRY=Object.freeze(registry);
export function getModelConfig(key){const c=MODEL_REGISTRY[key];if(!c)throw new Error(`modelRegistry: unknown model key "${key}"`);return c}
