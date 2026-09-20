// pages/api/attendance/section-checkin.js
// Canonical section attendance endpoint.
// Writes an entire section in one set-based database operation.

import pool from '../../../lib/db';
import { withOrg } from '../../../lib/apiHelpers';

export default withOrg(async function handler(req,res){
  if(req.method!=='POST'){
    res.setHeader('Allow','POST');
    return res.status(405).json({error:'Method not allowed'});
  }

  const{session_id,section_name,present_ids}=req.body||{};
  if(!session_id||!section_name||!Array.isArray(present_ids)){
    return res.status(400).json({error:'Missing or invalid fields'});
  }

  const peopleIds=[...new Set(present_ids.filter(Boolean).map(String))];
  const orgId=req.org.id;
  const userId=req.user.id;
  const client=await pool.connect();

  try{
    await client.query('BEGIN');

    const session=await client.query(
      `SELECT id FROM sessions
       WHERE id=$1 AND organization_id=$2 AND status='active'
       LIMIT 1
       FOR UPDATE`,
      [session_id,orgId]
    );

    if(!session.rows.length){
      await client.query('ROLLBACK');
      return res.status(403).json({error:'Active session not found in your organization.'});
    }

    const assignment=await client.query(
      `SELECT 1 FROM session_users
       WHERE session_id=$1 AND user_id=$2
       LIMIT 1`,
      [session_id,userId]
    );

    if(!assignment.rows.length){
      await client.query('ROLLBACK');
      return res.status(403).json({error:'You are not assigned to this session.'});
    }

    const section=await client.query(
      `SELECT ss.id
       FROM session_sections ss
       JOIN sessions s ON s.id=ss.session_id
       WHERE ss.session_id=$1 AND ss.name=$2 AND s.organization_id=$3
       LIMIT 1`,
      [session_id,section_name,orgId]
    );

    if(!section.rows.length){
      await client.query('ROLLBACK');
      return res.status(404).json({error:'Section not found.'});
    }

    if(!peopleIds.length){
      await client.query('COMMIT');
      return res.status(200).json({success:true,marked:0});
    }

    const result=await client.query(
      `WITH requested AS (
         SELECT DISTINCT value::uuid AS person_id
         FROM unnest($5::text[]) AS t(value)
       ),
       valid AS (
         SELECT r.person_id
         FROM requested r
         JOIN people p
           ON p.id=r.person_id
          AND p.organization_id=$1
          AND COALESCE(p.status,'active')='active'
       )
       INSERT INTO attendance_records(
         people_id,attendance_date,present,session_id,session_section_id,
         marked_by,marked_at,status,confirmed,organization_id
       )
       SELECT v.person_id,CURRENT_DATE,true,$2,$3,$4,NOW(),'present',false,$1
       FROM valid v
       ON CONFLICT(organization_id,people_id,session_id)
         WHERE session_id IS NOT NULL
       DO UPDATE SET
         present=true,
         session_section_id=EXCLUDED.session_section_id,
         marked_by=EXCLUDED.marked_by,
         marked_at=NOW(),
         status='present',
         confirmed=false
       RETURNING people_id`,
      [orgId,session_id,section.rows[0].id,userId,peopleIds]
    );

    const validCount=await client.query(
      `SELECT COUNT(*)::int AS count
       FROM people p
       WHERE p.organization_id=$1
         AND p.id=ANY($2::uuid[])
         AND COALESCE(p.status,'active')='active'`,
      [orgId,peopleIds]
    );

    if((Number(validCount.rows[0]?.count)||0)!==peopleIds.length){
      // Keep the section atomic: an invalid person must not leave a partial submission.
      await client.query('ROLLBACK');
      return res.status(403).json({
        error:'One or more people are outside your organization or inactive.'
      });
    }

    await client.query('COMMIT');
    return res.status(200).json({
      success:true,
      marked:result.rowCount
    });
  }catch(err){
    try{await client.query('ROLLBACK')}catch{}
    console.error('[ATTENDANCE] Section checkin error:',err);
    return res.status(500).json({error:'Could not record section attendance.'});
  }finally{
    client.release();
  }
});
