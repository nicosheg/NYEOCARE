// lib/aiProvider.js
import*as core from'./aiProviderCore';import{generateText}from'./aiGateway';
export const SCAN_PIPELINE_VERSION=core.SCAN_PIPELINE_VERSION;
export const getScanAdmission=core.getScanAdmission;
export const callVisionWithRetry=core.callVisionWithRetry;
export async function generateChatCompletion({systemPrompt='',userPrompt='',temperature=.4,max_tokens=500,organizationId=null,purpose='legacy_chat'}={}){const r=await generateText({organizationId,purpose,maxTokens:max_tokens,temperature,system:systemPrompt,user:userPrompt});return r.text}
