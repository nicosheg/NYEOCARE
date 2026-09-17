// lib/confidenceUtils.js
export function normalizeConfidence(value){if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(100,Math.round(n))):null}
