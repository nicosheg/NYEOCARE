// lib/scanState.js
export const INTERNAL_STATES={QUEUED:'queued',ANALYSING:'analysing',EXTRACTING:'extracting',VALIDATING:'validating',MATCHING:'matching',SAVING:'saving',COMPLETED:'completed',RETRYING:'retrying',FAILED:'failed',TIMED_OUT:'timed_out',CANCELLED:'cancelled'};
export const PROGRESS_STAGES={enhancing:'enhancing',layout_analysis:'layout_analysis',reading_handwriting:'reading_handwriting',verifying_rows:'verifying_rows',validating:'validating',matching_community:'matching_community',building_memory:'building_memory',complete:'complete'};

const SCAN_PROGRESS_COPY=Object.freeze({
 queued:{title:'Scan queued',message:'Your register is waiting for the scan worker to begin.'},
 pending:{title:'Scan queued',message:'Your register is waiting for the scan worker to begin.'},
 preparing_image:{title:'Preparing the register image',message:'Checking image orientation and preparing the visible page for reading.'},
 understanding_page:{title:'Examining the page layout',message:'Locating the register rows and the columns that may contain names, phones, and dates of birth.'},
 reading_page:{title:'Reading the register',message:'Reading each visible row. A missing phone or date stays missing; ARIA will not fill it from a neighboring row.'},
 reading_overlapping_regions:{title:'Reading the register',message:'Reading overlapping sections so row edges, honorifics, phone numbers, and dates of birth are less likely to be missed.'},
 cross_checking:{title:'Cross-checking the reading',message:'Comparing independent readings of the visible names, phone digits, row ownership, and any written dates.'},
 validating_extraction:{title:'Validating the extracted details',message:'Checking that the transcribed text fits the row and that numbers and dates are not guessed.'},
 validating:{title:'Validating the extracted details',message:'Checking that the transcribed text fits the row and that numbers and dates are not guessed.'},
 resolving_identity:{title:'Verifying name-and-phone pairs',message:'Comparing each readable name and phone number with existing people in this organization.'},
 matching_community:{title:'Verifying name-and-phone pairs',message:'Comparing each readable name and phone number with existing people in this organization.'},
 saving_truth:{title:'Saving verified results',message:'Saving verified identities and keeping uncertain rows in Review Center. Rows without a safe name-and-phone match are not promoted to People.'},
 saving:{title:'Saving verified results',message:'Saving verified identities and keeping uncertain rows in Review Center.'},
 building_memory:{title:'Saving verified results',message:'Recording the verified scan observations and review items.'},
 complete:{title:'Scan complete',message:'ARIA finished processing the register. Check Review Center for rows that need a human decision.'},
 completed:{title:'Scan complete',message:'ARIA finished processing the register. Check Review Center for rows that need a human decision.'},
 failed:{title:'Scan stopped safely',message:'ARIA could not complete this scan. No unverified people were promoted to People.'},
 cancelled:{title:'Scan cancelled',message:'The scan was cancelled safely.'},
 timed_out:{title:'Scan stopped safely',message:'ARIA stopped because progress was no longer moving. Your existing people were not changed by an unfinished scan.'}
});
export function scanProgressDetail(progress,state='processing'){
 const key=String(progress||state||'processing').toLowerCase(),base=SCAN_PROGRESS_COPY[key]||SCAN_PROGRESS_COPY[String(state||'').toLowerCase()]||{title:'Processing the register',message:'ARIA is working through the current scan stage.'};
 return{stage:key,title:base.title,message:base.message,updated_at:new Date().toISOString()};
}
export function ariaMessageForState(state,progress){
 return scanProgressDetail(progress,state).message;
}
export function dbStatusFromInternal(state){return{queued:'pending',analysing:'processing',extracting:'processing',validating:'processing',matching:'processing',saving:'processing',completed:'complete',retrying:'retrying',failed:'failed',timed_out:'failed',cancelled:'failed'}[state]||'processing'}
