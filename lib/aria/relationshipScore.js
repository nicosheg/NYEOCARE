// lib/aria/relationshipScore.js
import pool from'../db';

const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));

export async function computeRelationshipScore(orgId,personIds=null){
 if(!orgId)throw new Error('orgId required');
 const ids=Array.isArray(personIds)&&personIds.length?[...new Set(personIds.map(String))]:null;
 const people=await pool.query(`INSERT INTO relationship_scores(organization_id,person_id,score,relationship_state,evidence,calculated_at,updated_at)
 SELECT p.organization_id,p.id,
   LEAST(100,GREATEST(0,ROUND(
     35
     +LEAST(25,COALESCE(em.participation_rate,0)*.25)
     +LEAST(15,COALESCE(em.participation_streak,0)*3)
     +LEAST(10,COALESCE(pm.memory_count,0)*2)
     +LEAST(10,COALESCE(io.positive_count,0)*2)
     -LEAST(8,COALESCE(io.negative_count,0)*2)
     +GREATEST(-5,LEAST(5,COALESCE(em.trend,0)*5))
   )))::int AS score,
   CASE
     WHEN LEAST(100,GREATEST(0,ROUND(35+LEAST(25,COALESCE(em.participation_rate,0)*.25)+LEAST(15,COALESCE(em.participation_streak,0)*3)+LEAST(10,COALESCE(pm.memory_count,0)*2)+LEAST(10,COALESCE(io.positive_count,0)*2)-LEAST(8,COALESCE(io.negative_count,0)*2)+GREATEST(-5,LEAST(5,COALESCE(em.trend,0)*5)))))>=80 THEN 'strong'
     WHEN LEAST(100,GREATEST(0,ROUND(35+LEAST(25,COALESCE(em.participation_rate,0)*.25)+LEAST(15,COALESCE(em.participation_streak,0)*3)+LEAST(10,COALESCE(pm.memory_count,0)*2)+LEAST(10,COALESCE(io.positive_count,0)*2)-LEAST(8,COALESCE(io.negative_count,0)*2)+GREATEST(-5,LEAST(5,COALESCE(em.trend,0)*5)))))>=60 THEN 'healthy'
     WHEN LEAST(100,GREATEST(0,ROUND(35+LEAST(25,COALESCE(em.participation_rate,0)*.25)+LEAST(15,COALESCE(em.participation_streak,0)*3)+LEAST(10,COALESCE(pm.memory_count,0)*2)+LEAST(10,COALESCE(io.positive_count,0)*2)-LEAST(8,COALESCE(io.negative_count,0)*2)+GREATEST(-5,LEAST(5,COALESCE(em.trend,0)*5)))))>=40 THEN 'developing'
     ELSE 'known'
   END AS relationship_state,
   jsonb_build_object('participation_rate',COALESCE(em.participation_rate,0),'participation_streak',COALESCE(em.participation_streak,0),'memory_count',COALESCE(pm.memory_count,0),'positive_outcomes',COALESCE(io.positive_count,0),'negative_outcomes',COALESCE(io.negative_count,0),'trend',COALESCE(em.trend,0),'confidence',COALESCE(em.confidence,0)) AS evidence,
   NOW(),NOW()
 FROM people p
 LEFT JOIN engagement_metrics em ON em.organization_id=p.organization_id AND em.person_id=p.id
 LEFT JOIN(SELECT organization_id,person_id,COUNT(*)::int memory_count FROM person_memory WHERE active=true AND organization_id=$1 GROUP BY organization_id,person_id)pm ON pm.organization_id=p.organization_id AND pm.person_id=p.id
 LEFT JOIN(SELECT organization_id,person_id,COUNT(*) FILTER(WHERE outcome IN('positive','helpful','worked','returned','became_regular','relationship_strengthened'))::int positive_count,COUNT(*) FILTER(WHERE outcome IN('negative','ineffective','did_not_work','unsuccessful','no_response'))::int negative_count FROM intelligence_outcomes WHERE organization_id=$1 GROUP BY organization_id,person_id)io ON io.organization_id=p.organization_id AND io.person_id=p.id
 WHERE p.organization_id=$1 AND p.status='active' AND ($2::uuid[] IS NULL OR p.id=ANY($2::uuid[]))
 ON CONFLICT(organization_id,person_id) DO UPDATE SET score=EXCLUDED.score,relationship_state=EXCLUDED.relationship_state,evidence=EXCLUDED.evidence,calculated_at=NOW(),updated_at=NOW()
 RETURNING person_id`,[orgId,ids]);
 return people.rowCount||0;
}

export async function getTopRelationships(orgId,limit=10){
 if(!orgId)throw new Error('orgId required');
 const n=Math.min(Math.max(Number(limit)||10,1),100);
 const r=await pool.query(`SELECT rs.person_id,rs.score,rs.relationship_state,rs.evidence,p.first_name,p.last_name,p.display_name,p.phone FROM relationship_scores rs JOIN people p ON p.id=rs.person_id AND p.organization_id=rs.organization_id WHERE rs.organization_id=$1 ORDER BY rs.score DESC LIMIT $2`,[orgId,n]);
 return r.rows;
}
