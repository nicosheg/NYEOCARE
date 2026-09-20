// lib/aria/engagementIntelligence.js
import pool from'../db';

const DAY=86400000;
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));

function calculate(dates,now){
 if(!dates.length)return{participationCount:0,participationRate:0,participationStreak:0,inactivityStreak:0,baselineFrequency:0,recentFrequency:0,trend:0,deviation:0,firstSeen:null,lastSeen:null,lastMeaningfulEvent:null,confidence:0,engagementStatus:'first_time',evidence:{sample_size:0}};
 const firstSeen=dates[0],lastSeen=dates[dates.length-1];
 const daysSinceLast=Math.max(0,(now-lastSeen)/DAY);
 const inactivityStreak=Math.floor(daysSinceLast/7);
 const recent=dates.filter(d=>d>=new Date(now.getTime()-28*DAY));
 const prior=dates.filter(d=>d>=new Date(now.getTime()-56*DAY)&&d<new Date(now.getTime()-28*DAY));
 const baseline=dates.filter(d=>d>=new Date(now.getTime()-84*DAY));
 const recentFrequency=recent.length/4,baselineFrequency=baseline.length/12,priorFrequency=prior.length/4;
 const trend=priorFrequency===0?(recentFrequency?1:0):clamp((recentFrequency-priorFrequency)/priorFrequency,-1,1);
 const expected=Math.max(.25,baselineFrequency);
 const deviation=clamp((recentFrequency-expected)/expected,-1,1);
 const weeks=new Set(baseline.map(d=>Math.floor((now-d)/DAY/7))).size;
 const participationStreak=(()=>{const s=new Set(dates.map(d=>Math.floor((now-d)/DAY/7)));let n=0;while(s.has(n))n++;return n})();
 const participationRate=clamp(Math.round((weeks/Math.min(12,Math.max(1,Math.ceil((now-firstSeen)/DAY/7))))*100),0,100);
 return{participationCount:dates.length,participationRate,participationStreak,inactivityStreak,baselineFrequency,recentFrequency,trend,deviation,firstSeen,lastSeen,lastMeaningfulEvent:lastSeen,confidence:clamp(dates.length/8,0,1),engagementStatus:null,evidence:{sample_size:dates.length,baseline_days:84,recent_days:28,days_since_last:Math.floor(daysSinceLast),baseline_frequency:baselineFrequency,recent_frequency:recentFrequency,prior_frequency:priorFrequency,trend,deviation,participation_streak:participationStreak,inactivity_streak:inactivityStreak}};
}

function finalize(m){
 m.engagementStatus=m.participationCount===0?'first_time':m.inactivityStreak===0?(m.participationCount===1?'returning':'regular'):m.inactivityStreak<4?'less_recent':'quiet';
 return m;
}

export async function updateEngagementMetricsForPeople(personIds,orgId){
 if(!orgId)throw new Error('orgId required');
 const ids=[...new Set((Array.isArray(personIds)?personIds:[]).map(String).filter(Boolean))];
 if(!ids.length)return 0;
 const r=await pool.query(`SELECT person_id,occurred_at FROM participation_records WHERE organization_id=$1 AND person_id=ANY($2::uuid[]) AND occurred_at IS NOT NULL ORDER BY person_id,occurred_at ASC`,[orgId,ids]);
 const grouped=new Map();
 for(const row of r.rows){const key=String(row.person_id);if(!grouped.has(key))grouped.set(key,[]);const d=new Date(row.occurred_at);if(!Number.isNaN(d.getTime()))grouped.get(key).push(d);}
 const now=new Date(),payload=ids.map(personId=>{
  const m=finalize(calculate(grouped.get(String(personId))||[],now));
  return{person_id:personId,participation_count:m.participationCount,participation_rate:m.participationRate,participation_streak:m.participationStreak,inactivity_streak:m.inactivityStreak,baseline_frequency:m.baselineFrequency,recent_frequency:m.recentFrequency,trend:m.trend,deviation:m.deviation,first_seen:m.firstSeen?.toISOString()||null,last_seen:m.lastSeen?.toISOString()||null,last_meaningful_event:m.lastMeaningfulEvent?.toISOString()||null,confidence:m.confidence,evidence:m.evidence};
 });
 await pool.query(`INSERT INTO engagement_metrics(organization_id,person_id,participation_count,participation_rate,participation_streak,inactivity_streak,baseline_frequency,recent_frequency,trend,deviation,first_seen,last_seen,last_meaningful_event,confidence,evidence,calculated_at,updated_at)
 SELECT $1,x.person_id,x.participation_count,x.participation_rate,x.participation_streak,x.inactivity_streak,x.baseline_frequency,x.recent_frequency,x.trend,x.deviation,x.first_seen,x.last_seen,x.last_meaningful_event,x.confidence,x.evidence,NOW(),NOW()
 FROM jsonb_to_recordset($2::jsonb) AS x(person_id uuid,participation_count integer,participation_rate integer,participation_streak integer,inactivity_streak integer,baseline_frequency numeric,recent_frequency numeric,trend numeric,deviation numeric,first_seen timestamptz,last_seen timestamptz,last_meaningful_event timestamptz,confidence numeric,evidence jsonb)
 ON CONFLICT(organization_id,person_id) DO UPDATE SET participation_count=EXCLUDED.participation_count,participation_rate=EXCLUDED.participation_rate,participation_streak=EXCLUDED.participation_streak,inactivity_streak=EXCLUDED.inactivity_streak,baseline_frequency=EXCLUDED.baseline_frequency,recent_frequency=EXCLUDED.recent_frequency,trend=EXCLUDED.trend,deviation=EXCLUDED.deviation,first_seen=EXCLUDED.first_seen,last_seen=EXCLUDED.last_seen,last_meaningful_event=EXCLUDED.last_meaningful_event,confidence=EXCLUDED.confidence,evidence=EXCLUDED.evidence,calculated_at=NOW(),updated_at=NOW()`,[orgId,JSON.stringify(payload)]);
 return ids.length;
}

export async function updateEngagementMetricsForPerson(personId,orgId){
 if(!personId||!orgId)throw new Error('personId and orgId are required');
 await updateEngagementMetricsForPeople([personId],orgId);
 const r=await pool.query('SELECT * FROM engagement_metrics WHERE organization_id=$1 AND person_id=$2 LIMIT 1',[orgId,personId]);
 return r.rows[0]||null;
}

export async function updateEngagementMetrics(orgId,options={}){
 if(!orgId)throw new Error('orgId required');
 const limit=Math.max(1,Math.min(Number(options.chunkSize)||500,2000));
 const people=await pool.query(`SELECT id FROM people WHERE organization_id=$1 AND status='active' ORDER BY id LIMIT $2`,[orgId,limit]);
 await updateEngagementMetricsForPeople(people.rows.map(p=>p.id),orgId);
 return people.rows.length;
}
