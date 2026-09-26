// pages/api/aria/daily.js
// Canonical ARIA Today endpoint.
// All organization-level briefing interpretation comes from the ARIA Director.

import { withOrg } from '../../../lib/apiHelpers';
import { getDirectorBriefing } from '../../../lib/aria/directorEngine';

async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});

  try{
    const director=await getDirectorBriefing(req.org.id,{limit:8});
    const state=director.state||{};
    const intelligence=director.intelligence||{};
    const decisions=director.decisions||{};

    const summary=[
      director.primary_focus?.title||'ARIA is watching the organization.',
      director.primary_focus?.summary||''
    ].filter(Boolean).join(' — ');

    const nextAction=[
      director.primary_focus?.reason||'ARIA will keep observing until the evidence supports a stronger intervention.',
      intelligence.insight?.statement||''
    ].filter(Boolean).join(' ');

    const humanFocus=(decisions.human_focus||[]).map(x=>({
      id:x.person_id,
      personId:x.person_id,
      name:x.name,
      type:'HUMAN_FOCUS',
      observationType:x.observation||null,
      actionType:x.action||null,
      priorityScore:x.priority_score||0,
      reason:x.reason,
      nextAction:x.action==='SEND_MESSAGE'?'Review a personal message opportunity.':'Review the person context before acting.'
    }));

    const patterns=(intelligence.attendance_lens||[]).map(x=>({
      personId:x.person_id,
      name:x.person_name,
      type:'PATTERN',
      pattern:x.classification,
      evidence:{
        sessionsAttended:x.participation_count,
        attendanceRate:x.participation_rate,
        trend:x.trend,
        deviation:x.deviation,
        lifecycleState:x.lifecycle_state
      },
      message:x.reason,
      nextAction:'Let ARIA reconcile the signal with the person’s wider relationship context before escalating.'
    }));

    const operational=intelligence.operational_signals||{};
    const operationalItems=[];
    if(Number(operational.pending_scan_reviews)>0){
      operationalItems.push({
        type:'OPERATIONAL',
        name:'Scan review',
        reason:String(operational.pending_scan_reviews)+' scan review item(s) need human confirmation.',
        nextAction:'Open Review Center and resolve the uncertain records.'
      });
    }
    if(Number(operational.failed_sessions)>0){
      operationalItems.push({
        type:'OPERATIONAL',
        name:'Attendance processing',
        reason:String(operational.failed_sessions)+' attendance session(s) are still marked failed.',
        nextAction:'Review the processing state before relying on derived attendance intelligence.'
      });
    }

    return res.status(200).json({
      summary,
      nextAction,
      generatedAt:director.generated_at,
      director,
      organization:{
        peopleCount:Number(state.population)||0,
        sessionsLast30Days:Number(state.sessions_30_days)||0,
        activeAttendeesLast30Days:Number(state.active_attendees_30_days)||0,
        addedLast7Days:Number(state.added_last_7_days)||0,
        memoryCoverage:Number(state.human_memory_coverage_pct)||0
      },
      signals:{
        observations:humanFocus,
        patterns,
        actions:operationalItems
      }
    });
  }catch(err){
    console.error('[ARIA] Daily director error:',err);
    return res.status(500).json({error:'Unable to load ARIA daily intelligence.'});
  }
}

export default withOrg(handler);
