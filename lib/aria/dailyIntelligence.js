// lib/aria/dailyIntelligence.js
import pool from'../db';
import{getPriorityQueue}from'./priorityQueue';
import{getDirectorBriefing}from'./directorEngine';

export async function getDailyIntelligence(orgId){
 if(!orgId)throw new Error('orgId required');
 const briefing=await getDirectorBriefing(orgId,{limit:8});
 const f=briefing.state||{},i=briefing.intelligence||{};
 return{
  date:new Date().toISOString().slice(0,10),
  summary:briefing.primary_focus?.title||'ARIA is keeping the organization under observation.',
  director:briefing,
  facts:{
   activePeople:Number(f.population)||0,
   sessionsToday:Number(f.sessions_today)||0,
   participationLast30Days:Number(f.active_attendees_30_days)||0,
   rememberedPeople:Number(f.active_people_with_human_memory)||0,
   relationshipsReady:Number(f.relationships_ready)||0,
   activeCareSignals:Number(i.attention?.human_care_count)||0,
   careSignalsToday:Number(i.attention?.opportunity_count)||0,
   pendingActions:Object.values(i.action_inventory||{}).reduce((sum,v)=>sum+Number(v||0),0),
   learnedSignals:Number(f.outcome_count)||0
  },
  patterns:(i.attendance_lens||[]).slice(0,8).map(x=>({
   personId:x.person_id,name:x.person_name,type:x.classification,reason:x.reason,confidenceType:'CARE'
  })),
  nextAction:{
   type:'REVIEW',
   title:briefing.primary_focus?.title||'Keep observing',
   description:briefing.primary_focus?.reason||'ARIA does not see a stronger justified intervention yet.',
   personId:briefing.decisions?.human_focus?.[0]?.person_id||null
  }
 };
}
