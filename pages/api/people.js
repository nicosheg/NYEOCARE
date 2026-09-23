// pages/api/people.js
import pool from'../../lib/db';
import{normalizePhone}from'../../lib/phoneUtils';
import{normalizeDisplayName}from'../../lib/scanValidation';
import{withOrg}from'../../lib/apiHelpers';
import{emitAriaEvent}from'../../lib/aria/eventEmitter';
import{directAriaEvent}from'../../lib/aria/director';
const splitName=value=>{const n=normalizeDisplayName(value),parts=n.core.split(/\s+/).filter(Boolean);return{first_name:parts.shift()||'',last_name:parts.join(' '),display_name:n.display}}
async function duplicatePhone(orgId,phone,excludeId=null){if(!phone)return null;const q=await pool.query(`SELECT id,display_name,phone FROM people WHERE organization_id=$1 AND status='active' AND living_truth->>'status' NOT IN ('needs_decision','conflict') AND id<>COALESCE($2::uuid,'00000000-0000-0000-0000-000000000000') AND (phone=$3 OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(phone_numbers,'[]'::jsonb)) v WHERE v->>'normalized'=$3)) LIMIT 1`,[orgId,excludeId,phone]);return q.rows[0]||null}
async function handler(req,res){const orgId=req.org.id;if(req.method!=='GET'&&!['owner','admin'].includes(req.user.role))return res.status(403).json({error:'Admin permissions required'});
if(req.method==='GET'){
 try{
  const limit=Math.min(Math.max(Number.parseInt(req.query?.limit,10)||50,1),80);
  const search=String(req.query?.search||'').trim().slice(0,80);
  const type=String(req.query?.type||'').trim().toLowerCase();
  const living=String(req.query?.living_truth||'').trim();
  const includeTotal=!req.query?.cursor;
  const rawCursor=String(req.query?.cursor||'').trim();
  let cursor=null;
  if(rawCursor){
   try{
    cursor=JSON.parse(Buffer.from(rawCursor,'base64url').toString('utf8'));
    if(!Number.isInteger(cursor.new_rank)||!Number.isInteger(cursor.truth_rank)||typeof cursor.sort_name!=='string'||typeof cursor.id!=='string')throw new Error('bad cursor');
   }catch{ return res.status(400).json({error:'Invalid people cursor.',code:'INVALID_CURSOR'}); }
  }
  const where=["p.organization_id=$1","p.status='active'"];
  const values=[orgId];
  let n=2;
  if(type&&['member','visitor'].includes(type)){where.push(`p.type=$${n++}`);values.push(type)}
  if(living==='1')where.push(`COALESCE(p.living_truth->>'status','alive') IN ('needs_decision','conflict')`);
  if(search){
   const term=`%${search.replace(/[\\%_]/g,'\\$&')}%`;
   where.push(`(COALESCE(p.display_name,'') ILIKE $${n} ESCAPE '\\\\' OR COALESCE(TRIM(CONCAT_WS(' ',p.first_name,p.last_name)),'') ILIKE $${n} ESCAPE '\\\\' OR COALESCE(p.phone,'') ILIKE $${n} ESCAPE '\\\\' OR COALESCE(p.email,'') ILIKE $${n} ESCAPE '\\\\')`);
   values.push(term);n++;
  }
  const sortName=`LOWER(COALESCE(NULLIF(p.display_name,''),NULLIF(TRIM(CONCAT_WS(' ',p.first_name,p.last_name)),''),p.first_name,''))`;
  const cursorClause=cursor?`(r.new_rank,r.truth_rank,r.sort_name,r.id) > (${values.length+1}::int,${values.length+2}::int,${values.length+3}::text,${values.length+4}::uuid)`:'';
  const sql=`
   WITH latest_scan AS(
     SELECT started_at,completed_at
     FROM scan_jobs
     WHERE organization_id=$1 AND status='complete'
     ORDER BY completed_at DESC NULLS LAST,created_at DESC
     LIMIT 1
   ),
   ranked AS(
     SELECT
       p.id,p.organization_id,p.first_name,p.last_name,p.display_name,p.phone,p.email,p.type,p.birthday,
       p.living_truth,p.status,p.source,p.created_at,p.updated_at,p.last_scan_job_id,
       COALESCE(em.last_seen,(
         SELECT MAX(pr.occurred_at)
         FROM participation_records pr
         WHERE pr.organization_id=p.organization_id
           AND pr.person_id=p.id
           AND pr.participation_type='attendance'
       )) AS last_seen,
       (
         SELECT to_char(MAX(pr.occurred_at AT TIME ZONE 'UTC'),'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')
         FROM participation_records pr
         WHERE pr.organization_id=p.organization_id
           AND pr.person_id=p.id
           AND pr.participation_type='attendance'
       ) AS last_attended_date,
       CASE WHEN p.source='scan' AND ls.started_at IS NOT NULL
              AND p.created_at>=ls.started_at
              AND p.created_at<=COALESCE(ls.completed_at,NOW())
            THEN TRUE ELSE FALSE END AS new_from_latest_scan,
       ${sortName} AS sort_name,
       CASE WHEN p.source='scan' AND ls.started_at IS NOT NULL
              AND p.created_at>=ls.started_at
              AND p.created_at<=COALESCE(ls.completed_at,NOW())
            THEN 0 ELSE 1 END AS new_rank,
       CASE WHEN p.living_truth->>'status'='needs_decision' THEN 0
            WHEN p.living_truth->>'status'='conflict' THEN 1 ELSE 2 END AS truth_rank
     FROM people p
     LEFT JOIN engagement_metrics em
       ON em.organization_id=p.organization_id AND em.person_id=p.id
     LEFT JOIN latest_scan ls ON TRUE
     WHERE ${where.join(' AND ')}
   )
   SELECT r.id,r.first_name,r.last_name,r.display_name,r.phone,r.email,r.type,r.birthday,r.living_truth,r.last_seen,r.last_attended_date,r.new_from_latest_scan,r.new_rank,r.truth_rank,r.sort_name
   FROM ranked r
   WHERE ${cursorClause||'TRUE'}
   ORDER BY r.new_rank,r.truth_rank,r.sort_name,r.id
   LIMIT ${limit+1}`;
  const actualValues=cursor?[...values,cursor.new_rank,cursor.truth_rank,cursor.sort_name,cursor.id]:values;
  const result=await pool.query(sql,actualValues);
  const hasMore=result.rows.length>limit;
  const items=result.rows.slice(0,limit);
  const last=items[items.length-1];
  let total_count=null;
  if(includeTotal){
   const countSql=`SELECT COUNT(*)::int AS count FROM people p WHERE ${where.join(' AND ')}`;
   total_count=Number((await pool.query(countSql,values)).rows[0]?.count)||0;
  }
  const next_cursor=hasMore&&last?Buffer.from(JSON.stringify({new_rank:last.new_rank,truth_rank:last.truth_rank,sort_name:last.sort_name,id:last.id})).toString('base64url'):null;
  return res.status(200).json({items,next_cursor,has_more:hasMore,total_count,limit,search,type,living_truth:living});
 }catch(err){console.error('GET people error:',err);return res.status(500).json({error:'Unable to load people.'})}
}
if(req.method==='POST'){const body=req.body||{},name=String(body.full_name||'').trim();let first_name=String(body.first_name||'').trim(),last_name=String(body.last_name||'').trim(),display_name='';if(!first_name&&name){const split=splitName(name);first_name=split.first_name;last_name=split.last_name;display_name=split.display_name}else display_name=[first_name,last_name].filter(Boolean).join(' ');if(!first_name)return res.status(400).json({error:'A name is required'});if(first_name.length>150||last_name.length>150)return res.status(400).json({error:'Name is too long'});const phone=normalizePhone(body.phone);const type=String(body.type||'visitor').trim().toLowerCase();if(!['member','visitor'].includes(type))return res.status(400).json({error:'Type must be member or visitor'});try{const duplicate=await duplicatePhone(orgId,phone);if(duplicate)return res.status(409).json({error:'That full phone number already belongs to another person.',code:'DUPLICATE_ACTIVE_PERSON',person:duplicate});const person=(await pool.query(`INSERT INTO people(organization_id,first_name,last_name,display_name,phone,email,type,birthday,created_by,living_truth,status,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active','manual') RETURNING *`,[orgId,first_name,last_name,display_name||null,phone,String(body.email||'').trim().toLowerCase()||null,type,body.birthday||null,req.user.id,JSON.stringify({status:'alive',confidence:90,source:'canonical_record',updated_at:new Date().toISOString()})])).rows[0];try{const event=await emitAriaEvent({organizationId:orgId,personId:person.id,type:'PERSON_CREATED',source:'manual',actorId:req.user.id,metadata:{source:'api'},eventKey:`manual:${orgId}:person:${person.id}:created`});if(event)await directAriaEvent(event)}catch(err){console.error('ARIA person creation event failed:',err)}return res.status(201).json(person)}catch(err){console.error('POST person error:',err);return res.status(500).json({error:'Unable to create person.'})}}
if(req.method==='PUT'){const body=req.body||{},id=body.id;if(!id)return res.status(400).json({error:'id is required'});try{const check=await pool.query(`SELECT id,display_name FROM people WHERE id=$1 AND organization_id=$2 AND status='active' AND living_truth->>'status' NOT IN ('needs_decision','conflict') LIMIT 1`,[id,orgId]);if(!check.rows.length)return res.status(404).json({error:'Person not found'});let first_name=body.first_name,last_name=body.last_name,display_name; if(body.full_name!==undefined){let incoming=String(body.full_name).trim();const existing=normalizeDisplayName(check.rows[0].display_name||'');const parsed=normalizeDisplayName(incoming);if(existing.honorific&&!parsed.honorific)incoming=`${existing.honorific} ${incoming}`;const split=splitName(incoming);first_name=split.first_name;last_name=split.last_name;display_name=split.display_name}const updates=[],values=[];let n=1;if(first_name!==undefined){const v=String(first_name).trim();if(!v)return res.status(400).json({error:'Name cannot be empty'});if(v.length>150)return res.status(400).json({error:'Name is too long'});updates.push(`first_name=$${n++}`);values.push(v)}if(last_name!==undefined){updates.push(`last_name=$${n++}`);values.push(String(last_name||'').trim())}if(display_name!==undefined){updates.push(`display_name=$${n++}`);values.push(display_name||null)}if(body.phone!==undefined){const phone=normalizePhone(body.phone);const duplicate=await duplicatePhone(orgId,phone,id);if(duplicate)return res.status(409).json({error:'That full phone number already belongs to another person.',code:'DUPLICATE_ACTIVE_PERSON',person:duplicate});updates.push(`phone=$${n++}`);values.push(phone)}if(body.email!==undefined){updates.push(`email=$${n++}`);values.push(String(body.email||'').trim().toLowerCase()||null)}if(body.type!==undefined){const type=String(body.type||'visitor').trim().toLowerCase();if(!['member','visitor'].includes(type))return res.status(400).json({error:'Type must be member or visitor'});updates.push('type='+String.fromCharCode(36)+n++);values.push(type)}if(body.birthday!==undefined){updates.push(`birthday=$${n++}`);values.push(body.birthday||null)}if(!updates.length)return res.status(400).json({error:'No fields to update'});updates.push('updated_at=NOW()');values.push(id,orgId);const person=(await pool.query(`UPDATE people SET ${updates.join(',')} WHERE id=$${n} AND organization_id=$${n+1} AND status='active' AND living_truth->>'status' NOT IN ('needs_decision','conflict') RETURNING *`,values)).rows[0];if(!person)return res.status(404).json({error:'Person not found'});try{const event=await emitAriaEvent({organizationId:orgId,personId:id,type:'PERSON_UPDATED',source:'manual',actorId:req.user.id,metadata:{updated_fields:Object.keys(body).filter(k=>k!=='id')},eventKey:`manual:${orgId}:person:${id}:update:${Date.now()}`});if(event)await directAriaEvent(event)}catch(err){console.error('ARIA person update event failed:',err)}return res.status(200).json(person)}catch(err){console.error('PUT person error:',err);return res.status(500).json({error:'Unable to update person.'})}}
res.setHeader('Allow','GET,POST,PUT');return res.status(405).json({error:'Method not allowed'})}
export default withOrg(handler);
