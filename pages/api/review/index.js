// pages/api/review/index.js
import pool from'../../../lib/db';import{withOrg}from'../../../lib/apiHelpers';import{detectDuplicates}from'../../../lib/duplicateDetector';import{normalizeName,reasonInfo}from'../../../lib/scanValidation';import{normalizePhoneList}from'../../../lib/phoneUtils';import{resolveIdentities}from'../../../lib/identityResolver';
const nameOf=x=>String(x?.display_name||[x?.first_name,x?.last_name].filter(Boolean).join(' ')||x?.first_name||'').trim(),phonesOf=x=>normalizePhoneList(x),verified=x=>x?.verified===true||x?.verification_status==='verified'||x?.identity_verification_status==='verified';
async function refreshPendingIdentityReviews(client,organizationId,reviews){
 if(!reviews.length)return reviews;
 const inputs=reviews.map(x=>{
  const e=x.evidence?.extracted||{},phones=Array.isArray(x.extracted_phones)&&x.extracted_phones.length?x.extracted_phones:(Array.isArray(e.phones)&&e.phones.length?e.phones:Array.isArray(x.raw_phones)?x.raw_phones:[]);
  return{
   name:x.extracted_name||x.raw_name||e.name||'',
   display_name:x.extracted_name||x.raw_name||e.name||'',
   raw_name:x.raw_name||e.raw_name||x.extracted_name||'',
   first_name:e.first_name||null,last_name:e.last_name||null,
   phone:phones[0]||null,phone_numbers:phones,phones,
   rawPhones:Array.isArray(x.raw_phones)?x.raw_phones:[],
   row_number:x.row_number||e.row_number||null,
   extraction_review_reasons:Array.isArray(e.extraction_review_reasons)?e.extraction_review_reasons:(Array.isArray(x.review_reasons)?x.review_reasons:[])
  };
 });
 let resolved;
 try{resolved=await resolveIdentities(inputs,organizationId,'review-refresh',client,{version:'review-refresh-v2'});}catch(err){console.warn('[REVIEW] identity refresh skipped:',err?.message||err);return reviews}
 for(let i=0;i<reviews.length;i++){
  const x=reviews[i],r=resolved[i];if(!r)continue;
  const reasons=[...new Set(r.field_review_reasons||[])],alternatives=(r.name_suggestions||[]).map(v=>v?.name).filter(Boolean);
  const info=reasonInfo(reasons,alternatives);
  const evidence={
   ...(x.evidence||{}),
   identity:{
    ...(x.evidence?.identity||{}),
    model:'50_50_name_phone_v2',
    status:r.status,
    match:r.identity_match||'none',
    name_score:r.name_confidence??null,
    phone_score:r.phone_confidence??null,
    composite_score:r.evidence?.composite_score??r.confidence??null,
    margin:r.evidence?.margin??null,
    exact_name_owner_count:r.evidence?.exact_name_owner_count??0,
    exact_phone_owner_count:r.evidence?.exact_phone_owner_count??0,
    refreshed_at:new Date().toISOString()
   },
   extracted:{...(x.evidence?.extracted||{}),name_confidence:r.name_confidence??x.evidence?.extracted?.name_confidence??null,phone_confidence:r.phone_confidence??x.evidence?.extracted?.phone_confidence??null,pair_confidence:r.pair_confidence??x.evidence?.extracted?.pair_confidence??null,model_confidence:r.confidence??x.evidence?.extracted?.model_confidence??null,composite_score:r.evidence?.composite_score??r.confidence??null}
  };
  const candidates=Array.isArray(r.candidates)?r.candidates.slice(0,6):[];
  const reasonsWithIdentity=[...new Set([...reasons,...(r.status==='conflict'?['identity_conflict']:r.status==='needs_decision'?['identity_needs_decision']:[])])];
  const readable=reasonInfo(reasonsWithIdentity,alternatives);
  const reason=r.status==='conflict'?'More than one existing person matches this observation.':r.status==='needs_decision'?((r.reason==='exact_name_but_phone_conflicts')?'The exact name matches an existing person, but the phone evidence conflicts or is not confirmed.':readable.reason):readable.reason;
  const suggestion=r.status==='conflict'?'Compare the suggested people with the original register before choosing one.':r.status==='needs_decision'?'Compare both name and phone evidence with the original register before deciding.':readable.suggestion;
  await client.query(`UPDATE scan_review_items
    SET review_reasons=$1::jsonb,reason=$2,suggestion=$3,evidence=$4::jsonb,candidates=$5::jsonb,proposed_person_id=$6,updated_at=NOW()
    WHERE id=$7 AND organization_id=$8 AND status='pending'`,
    [JSON.stringify(reasonsWithIdentity),reason,suggestion,JSON.stringify(evidence),JSON.stringify(candidates),r.best_candidate_id||null,x.id,organizationId]
  );
  reviews[i]={...x,review_reasons:reasonsWithIdentity,reason,suggestion,evidence,candidates,proposed_person_id:r.best_candidate_id||null};
 }
 return reviews;
}
function learnedFor(item,rows){const targets=[normalizeName(item.raw_name||''),normalizeName(item.extracted_name||'')].filter(Boolean);return rows.filter(x=>{const v=x.value||{},a=normalizeName(v.observed_name||''),b=normalizeName(v.canonical_name||''),key=String(x.learning_key||'').toLowerCase();return targets.some(t=>t===a||t===b||key.includes(t))}).slice(0,4).map(x=>({scope:x.scope,learning_type:x.learning_type,confidence:Number(x.confidence||0),example_count:Number(x.example_count||1),value:x.value,learning_key:x.learning_key}));}
export default withOrg(async function handler(req,res){if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});if(req.query?.summary==='1'){try{const r=await pool.query(`SELECT
 (SELECT COUNT(*) FROM scan_review_items WHERE organization_id=$1 AND status='pending') AS count,
 0 AS attendance_count`,[req.org.id]);res.setHeader('Cache-Control','private,no-store,max-age=0,must-revalidate');return res.status(200).json({pending_count:Number(r.rows[0]?.count)||0,attendance_review_count:Number(r.rows[0]?.attendance_count)||0})}catch(e){return res.status(500).json({error:'Unable to load review summary.'})}}try{let reviews=(await pool.query(`SELECT * FROM scan_review_items WHERE organization_id=$1 AND status='pending' ORDER BY updated_at DESC,created_at DESC`,[req.org.id])).rows;const refreshClient=await pool.connect();try{await refreshClient.query('BEGIN');reviews=await refreshPendingIdentityReviews(refreshClient,req.org.id,reviews);await refreshClient.query('COMMIT')}catch(err){await refreshClient.query('ROLLBACK').catch(()=>{});console.warn('[REVIEW] identity refresh transaction rolled back:',err?.message||err)}finally{refreshClient.release()}const ids=[...new Set(reviews.map(x=>x.proposed_person_id).filter(Boolean).map(String))],live=ids.length?(await pool.query(`SELECT id,first_name,last_name,display_name,phone,phone_numbers,type,identity_verification_status,metadata FROM people WHERE organization_id=$1 AND status='active' AND id=ANY($2::uuid[])`,[req.org.id,ids])).rows:[],byId=new Map(live.map(x=>[String(x.id),x]));let learning=[];try{const a=await pool.query(`SELECT 'organization' scope,learning_type,learning_key,value,confidence,1 example_count FROM aria_learning WHERE organization_id=$1 AND active=true AND learning_domain='scan' AND learning_context='scan_extraction' ORDER BY confidence DESC,updated_at DESC LIMIT 120`,[req.org.id]);const g=await pool.query(`SELECT 'global' scope,learning_type,learning_key,value,confidence,example_count FROM aria_global_learning WHERE active=true AND learning_type IN('ocr_name_visual_confusion','ocr_phone_digit_confusion') ORDER BY confidence DESC,example_count DESC,updated_at DESC LIMIT 120`);learning=[...a.rows,...g.rows]}catch(e){console.warn('[REVIEW] learning hints unavailable:',e?.message||e)}
const scanItems=reviews.map(x=>{const candidates=(Array.isArray(x.candidates)?x.candidates:[]).map(c=>{const liveRow=byId.get(String(c.id));return liveRow?{...c,id:liveRow.id,name:nameOf(liveRow),phone:liveRow.phone,phones:phonesOf(liveRow),type:liveRow.type,verified:verified(liveRow),verification_status:liveRow.identity_verification_status}:c}).slice(0,6),hints=learnedFor(x,learning),learnedNames=hints.flatMap(h=>{const v=h.value||{};return[v.canonical_name,v.observed_name].filter(Boolean)}).filter((v,i,a)=>a.indexOf(v)===i).slice(0,4),learnedMessage=learnedNames.length?`Learned from earlier corrections: ${learnedNames.join(', ')}. The current register still remains the source of truth.`:null;return{id:`scan:${x.id}`,source_review_id:x.id,kind:'scan_identity_review',name:x.extracted_name||x.raw_name||'Unnamed person',first_name:null,last_name:null,phone:(x.extracted_phones||[])[0]||null,phones:Array.isArray(x.extracted_phones)?x.extracted_phones:[],type:'scan_observation',status:x.status,reason:x.reason||'ARIA found evidence that needs your decision.',suggestion:learnedMessage||x.suggestion||'Check the original register and confirm or correct the information.',raw_name:x.raw_name||null,raw_phones:x.raw_phones||[],row_number:x.row_number??null,scan_job_id:x.scan_job_id,candidate_ids:candidates.map(c=>c.id),candidates,review_reasons:Array.isArray(x.review_reasons)?x.review_reasons:[],identity_model:'50_50_name_phone_v2',identity_status:x.evidence?.identity?.status||null,name_score:x.evidence?.identity?.name_score??null,phone_score:x.evidence?.identity?.phone_score??null,composite_score:x.evidence?.identity?.composite_score??null,name_suggestions:learnedNames.map(name=>({name,source:'learned'})),name_alternatives:Array.isArray(x.evidence?.extracted?.name_alternatives)?x.evidence.extracted.name_alternatives:[],phone_flags:x.evidence?.extracted?.phone_flags||[],name_evidence:x.evidence?.extracted?.name_evidence??null,phone_evidence:x.evidence?.extracted?.phone_evidence??null,pair_evidence:x.evidence?.extracted?.pair_evidence??null,confidence:x.evidence?.extracted?.confidence??null,name_confidence:x.evidence?.extracted?.name_confidence??null,phone_confidence:x.evidence?.extracted?.phone_confidence??null,pair_confidence:x.evidence?.extracted?.pair_confidence??null,model_confidence:x.evidence?.extracted?.model_confidence??null,row_number_source:x.evidence?.extracted?.row_number_source||'model',learning_hints:hints,created_at:x.created_at,updated_at:x.updated_at,score:Number(candidates[0]?.score||0)}});
let groups=[],audit={people_count:0,verified_count:0,unverified_count:0,detector_version:null};try{const d=await detectDuplicates(req.org.id);audit={people_count:d.people_count||0,verified_count:d.verified_count||0,unverified_count:d.unverified_count||0,detector_version:d.detector_version||null};groups=(d.groups||[]).map(g=>{const ordered=[...g.members].sort((a,b)=>Number(b.verified)-Number(a.verified)||String(a.name).localeCompare(String(b.name))),anchor=ordered[0],candidates=g.members.map(m=>({id:m.id,name:m.name,phone:m.phone||null,phones:phonesOf(m),type:m.type||'person',score:g.score,verified:m.verified,verification_status:m.verification_status||'unverified'}));return{id:`db:${g.id}`,kind:'database_duplicate',name:ordered.length>1?`${anchor.name} · ${ordered.slice(1).map(x=>x.name).join(' · ')}`:anchor.name,first_name:anchor.name,last_name:'',phone:anchor.phone||null,phones:phonesOf(anchor),type:'person',status:g.status,reason:g.reason||'These active records share enough identity evidence to require a duplicate check.',suggestion:'Compare the records. Merge only when the evidence belongs to one person; otherwise keep them separate.',score:g.score,candidates,verified_ids:g.members.filter(m=>m.verified).map(m=>m.id),group:g.members,duplicate_evidence:Array.isArray(g.evidence)?g.evidence:[],detector_version:audit.detector_version,created_at:null,updated_at:null}})}catch(err){console.warn('[REVIEW] duplicate detector skipped:',err.message)}
const merged=[...scanItems,...groups].sort((a,b)=>Number(b.score||0)-Number(a.score||0));return res.status(200).json({items:merged,total:merged.length,pending_count:scanItems.length+groups.length,scan_pending_count:scanItems.length,attendance_review_count:0,database_duplicate_count:groups.length,people_count:audit.people_count,verified_count:audit.verified_count,unverified_count:audit.unverified_count,detector_version:audit.detector_version});}catch(err){console.error('[REVIEW] List error:',err);return res.status(500).json({error:'Review Center could not load.'})}});
