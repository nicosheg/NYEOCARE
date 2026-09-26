import {getDirectorBriefing} from '../../../lib/aria/directorEngine';
import {withOrg} from '../../../lib/apiHelpers';

async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});

  const orgId=req.org.id;

  try{
    const director=await getDirectorBriefing(orgId,{limit:8});
    const state=director.state||{};
    const intelligence=director.intelligence||{};
    const decisions=director.decisions||{};
    const operations=intelligence.operational_signals||{};

    return res.status(200).json({
      summary:director.insight?.statement||director.primary_focus?.summary||'ARIA is keeping the organization’s context current.',
      nextAction:director.primary_focus?.title||'Keep observing',
      generatedAt:director.generated_at,
      director,
      organization:{
        peopleCount:Number(state.population)||0,
        sessionsLast30Days:Number(state.sessions_30_days)||0,
        activeAttendeesLast30Days:Number(state.active_attendees_30_days)||0,
        peopleAddedLast7Days:Number(state.added_last_7_days)||0
      },
      signals:{
        observations:decisions.human_focus||[],
        opportunities:decisions.opportunities||[],
        watchlist:decisions.watchlist||[],
        operational:{
          pendingScanReviews:Number(operations.pending_scan_reviews)||0,
          unhealthyEvents:Number(operations.unhealthy_events)||0,
          pendingEvents:Number(operations.pending_events)||0,
          deadEvents:Number(operations.dead_events)||0,
          highPriorityActions:Number(operations.high_priority_operational_actions)||0
        },
        contradictions:intelligence.contradictions||[]
      }
    });
  }catch(err){
    console.error('[ARIA] Daily intelligence error:',err);
    return res.status(500).json({error:'Unable to load ARIA daily intelligence.'});
  }
}
export default withOrg(handler);
