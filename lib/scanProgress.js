// lib/scanProgress.js
const PHASES=['preparing','reading','checking','matching','remembering'];
const MAP={
 queued:['preparing','Preparing the register','Getting the register ready.'],
 preparing_image:['preparing','Preparing the register','Checking and preparing the captured image.'],
 recording_image_hash:['preparing','Securing the scan','Recording the scan safely before processing.'],
 saving_evidence:['preparing','Securing the scan','Preserving the original register evidence.'],
 entering_vision:['reading','Starting vision reading','Sending the prepared register to ARIA vision.'],
 understanding_page:['reading','Reading the register','Mapping the full page before extracting rows.'],
 reading_page:['reading','Reading the register','Reading names, phone numbers, and physical row structure.'],
 reading_full_page:['reading','Reading the register','Reading the full register from top to bottom.'],
 extracting:['reading','Extracting observations','Reading the visible names and phone numbers.'],
 reconstructing_rows:['checking','Reconstructing rows','Rebuilding the physical register row structure.'],
 validating_extraction:['checking','Checking the reading','Testing what can be safely trusted from the pixels.'],
 validating:['checking','Checking the reading','Rejecting malformed or unsafe observations.'],
 resolving_identity:['matching','Reconciling identities','Comparing the scan with people already remembered.'],
 matching_community:['matching','Reconciling identities','Comparing names and phone evidence with known people.'],
 saving_truth:['remembering','Remembering people','Saving only identities ARIA can safely resolve.'],
 building_memory:['remembering','Building memory','Recording new evidence and durable identity memory.'],
 building_result:['remembering','Finishing the scan','Preparing the final scan result.'],
 committing_state:['remembering','Finishing the scan','Committing the final state safely.'],
 provider_wait:['reading','Provider is temporarily busy','ARIA is waiting for the vision service to become available.'],
 retrying:['reading','Retrying safely','ARIA is taking another controlled attempt.'],
 complete:['remembering','Register ready','The scan completed successfully.'],
 failed:['preparing','Scan stopped','ARIA stopped safely so uncertain data was not written.'],
 cancelled:['preparing','Scan cancelled','The scan was cancelled before more data was changed.'],
};
function baseFor(progress,status){
 const key=String(progress||status||'queued').toLowerCase();
 const found=MAP[key]||['reading','Working through the register','ARIA is processing the scan safely.'];
 const phaseIndex=Math.max(0,PHASES.indexOf(found[0]));
 return{phase:found[0],phase_index:phaseIndex,phase_count:PHASES.length,stage:key,title:found[1],message:found[2]};
}
export function describeScanProgress(progress,status='processing',extra={}){
 return{...baseFor(progress,status),status,updated_at:new Date().toISOString(),...extra};
}
export function scanPhases(){return PHASES.slice()}
