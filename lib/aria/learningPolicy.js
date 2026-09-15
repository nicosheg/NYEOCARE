// lib/aria/learningPolicy.js
export const LEARNING_DOMAINS=Object.freeze({SCAN:'scan',PERSONALIZED:'personalized'});
export const SCAN_SCOPES=Object.freeze({GLOBAL:'global',ORGANIZATION:'organization'});
export const PERSONALIZED_SCOPES=Object.freeze({GLOBAL:'global',ORGANIZATION:'organization',PERSONAL:'personal'});
export function scanLearningRow(row){return{learning_domain:LEARNING_DOMAINS.SCAN,learning_context:'scan_extraction',scope_level:row.scope_level||SCAN_SCOPES.ORGANIZATION,privacy_class:row.privacy_class||'scan_identity_private'}}
export function personalizedLearningRow(row){return{learning_domain:LEARNING_DOMAINS.PERSONALIZED,learning_context:'personalized',scope_level:row.scope_level||'personal',privacy_class:row.privacy_class||'personalized'}}
export function scanLearningContext(rows){const organization=rows.filter(x=>x.learning_domain==='scan'&&x.scope_level==='organization').slice(0,20).map(x=>({type:x.learning_type,key:x.learning_key,value:x.value,confidence:Number(x.confidence||0)}));const global=rows.filter(x=>x.learning_domain==='scan'&&x.scope_level==='global').slice(0,20).map(x=>({type:x.learning_type,key:x.learning_key,value:x.value,confidence:Number(x.confidence||0)}));return JSON.stringify({domain:'scan',organization,global})}
