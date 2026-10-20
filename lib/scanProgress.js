// lib/scanProgress.js
// Deterministic milestone progress from the canonical scan_jobs state.
// This is pipeline/section completion, not a claim about hidden model-token progress.
export function getScanProgressPercent(status,stage,detail={}){
 if(status==='complete'||stage==='complete')return 100;
 if(['failed','cancelled'].includes(status)||['failed','cancelled'].includes(stage))return 0;
 if(status==='pending'||stage==='queued'||stage==='pending')return 0;
 if(stage==='preparing_image')return 4;
 if(stage==='understanding_page')return 10;
 if(['reading_page','reading_overlapping_regions','reading_regions'].includes(stage)){
  const total=Math.max(1,Number(detail.regions_total)||1);
  const completed=Math.min(total,Math.max(0,Number(detail.regions_completed)||0));
  return Math.round(15+50*(completed/total));
 }
 if(stage==='cross_checking')return 70;
 if(['validating_extraction','validating'].includes(stage))return 75;
 if(stage==='resolving_identity')return 85;
 if(stage==='saving_truth')return 95;
 return status==='processing'||status==='retrying'?10:0;
}
