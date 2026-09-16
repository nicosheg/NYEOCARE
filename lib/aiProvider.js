// lib/aiProvider.js
import*as core from'./aiProviderCore';
export const{SCAN_PIPELINE_VERSION,getScanAdmission}=core;
export async function callVisionWithRetry(img,_unused,onProgress=null,opt={}){return core.callVisionWithRetry(img,_unused,onProgress,opt)}
