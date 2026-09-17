// lib/aiProvider.js
import{generateText}from'./aiGateway';import{callVisionWithRetry,getScanAdmission,SCAN_PIPELINE_VERSION}from'./hybridScanProvider';
export{callVisionWithRetry,getScanAdmission,SCAN_PIPELINE_VERSION};
export async function generateChatCompletion({systemPrompt='',userPrompt='',temperature=.4,max_tokens=500,organizationId=null,purpose='legacy_chat'}={}){const r=await generateText({organizationId,purpose,maxTokens:max_tokens,temperature,system:systemPrompt,user:userPrompt});return r.text}
