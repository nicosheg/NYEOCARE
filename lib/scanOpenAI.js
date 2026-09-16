// lib/scanOpenAI.js
import crypto from'crypto';import{processVisionJob,SCAN_PIPELINE_VERSION}from'./visionProcessor';
export const VERSION=SCAN_PIPELINE_VERSION;export function getCanonicalImageHash(image){const s=String(image||'').replace(/^data:[^;]+;base64,/,'').replace(/\s/g,'');return crypto.createHash('sha256').update(Buffer.from(s,'base64')).digest('hex')};export const runScanOpenAI=processVisionJob;
