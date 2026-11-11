// pages/api/operator-pulse.js
import pool from '../../lib/db';
import {withOrg} from '../../lib/apiHelpers';

const validScore=value=>Number.isInteger(value)&&value>=1&&value<=5;

export default withOrg(async function handler(req,res){
 res.setHeader('Cache-Control','private,no-store,max-age=0,must-revalidate');
 if(req.user.role!=='user')return res.status(403).json({error:'This reflection is for operator accounts.'});
 try{
  const state=(await pool.query(`SELECT u.created_at,
    date_trunc('week',NOW() AT TIME ZONE COALESCE(NULLIF(o.settings->>'timezone',''),'Africa/Lagos'))::date week_start,
    EXISTS(
      SELECT 1 FROM aria_daily_queue_items q
      WHERE q.organization_id=o.id AND q.assigned_user_id=u.id
        AND q.status='completed' AND q.task_kind IN('follow_up','action','scan_review')
    ) first_value
   FROM organizations o JOIN users u ON u.organization_id=o.id
   WHERE o.id=$1 AND u.id=$2 AND u.active=true LIMIT 1`,
   [req.org.id,req.user.id])).rows[0];
  if(!state)return res.status(404).json({error:'Operator profile not found.'});
  const weekStart=String(state.week_start).slice(0,10);
  const pulse=(await pool.query(`SELECT ease_score,clarity_score,confidence_score,submitted_at,dismissed_at
   FROM operator_experience_pulses
   WHERE organization_id=$1 AND operator_user_id=$2 AND week_start=$3::date
   LIMIT 1`,[req.org.id,req.user.id,weekStart])).rows[0]||null;
  const joinedAt=new Date(state.created_at).getTime();
  const oneWeekOld=Number.isFinite(joinedAt)&&Date.now()-joinedAt>=7*86400000;
  const eligible=state.first_value===true||oneWeekOld;
  if(req.method==='GET'){
   return res.status(200).json({eligible,due:eligible&&!pulse?.submitted_at&&!pulse?.dismissed_at,submitted:Boolean(pulse?.submitted_at),week_start:weekStart});
  }
  if(req.method!=='POST'){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Method not allowed'});}
  const action=String(req.body?.action||'submit');
  if(action==='dismiss'){
   if(!eligible)return res.status(409).json({error:'This reflection is not due yet.'});
   await pool.query(`INSERT INTO operator_experience_pulses(organization_id,operator_user_id,week_start,dismissed_at)
    VALUES($1,$2,$3::date,NOW())
    ON CONFLICT(organization_id,operator_user_id,week_start)
    DO UPDATE SET dismissed_at=NOW(),updated_at=NOW()
    WHERE operator_experience_pulses.submitted_at IS NULL`,
    [req.org.id,req.user.id,weekStart]);
   return res.status(200).json({success:true,dismissed:true});
  }
  const ease=Number(req.body?.ease_score),clarity=Number(req.body?.clarity_score),confidence=Number(req.body?.confidence_score);
  if(!eligible)return res.status(409).json({error:'This reflection is not due yet.'});
  if(!validScore(ease)||!validScore(clarity)||!validScore(confidence))return res.status(400).json({error:'Answer all three questions using a score from 1 to 5.'});
  const saved=await pool.query(`INSERT INTO operator_experience_pulses
    (organization_id,operator_user_id,week_start,ease_score,clarity_score,confidence_score,submitted_at,dismissed_at)
    VALUES($1,$2,$3::date,$4,$5,$6,NOW(),NULL)
    ON CONFLICT(organization_id,operator_user_id,week_start)
    DO UPDATE SET ease_score=EXCLUDED.ease_score,clarity_score=EXCLUDED.clarity_score,
      confidence_score=EXCLUDED.confidence_score,submitted_at=NOW(),dismissed_at=NULL,updated_at=NOW()
    RETURNING submitted_at`,
    [req.org.id,req.user.id,weekStart,ease,clarity,confidence]);
  return res.status(200).json({success:true,submitted_at:saved.rows[0]?.submitted_at||null});
 }catch(error){
  console.error('[OPERATOR PULSE] request failed:',error?.message||error);
  return res.status(500).json({error:'NYEOCARE could not save this reflection safely.'});
 }
});
