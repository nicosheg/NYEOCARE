// pages/api/aria/drafts.js
import{withOrg}from'../../../lib/apiHelpers';
import pool from'../../../lib/db';
const clean=(v,max=300)=>String(v??'').trim().slice(0,max);
const whatsappUrl=raw=>{const digits=String(raw||'').replace(/\D/g,'');const wa=digits.startsWith('00')?digits.slice(2):digits.startsWith('234')?digits:digits.startsWith('0')&&digits.length===11?'234'+digits.slice(1):/^[789]\d{9}$/.test(digits)?'234'+digits:digits;return wa?`https://wa.me/${wa}`:null};

export default withOrg(async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 try{
  const limit=Math.min(Math.max(Number(req.query?.limit)||100,1),200);
  const result=await pool.query(
   `SELECT c.id,c.person_id,c.channel,c.status,c.subject,c.content,c.metadata,c.created_at,c.updated_at,
           p.display_name,p.first_name,p.last_name,p.phone,p.phone_numbers
    FROM person_communications c
    JOIN people p ON p.id=c.person_id AND p.organization_id=c.organization_id
    WHERE c.organization_id=$1 AND c.direction='outbound' AND c.status='draft'
      AND c.channel='whatsapp' AND p.status='active'
    ORDER BY c.created_at DESC
    LIMIT $2`,
   [req.org.id,limit]
  );
  const drafts=result.rows.map(row=>{
   const rawPhone=row.metadata?.phone||row.phone||((Array.isArray(row.phone_numbers)&&row.phone_numbers[0])||null);
   const base=whatsappUrl(rawPhone);
   const message=String(row.content||'').trim();
   return{
    id:row.id,
    person_id:row.person_id,
    name:row.display_name||[row.first_name,row.last_name].filter(Boolean).join(' ')||'Person',
    message,
    phone:rawPhone||null,
    channel:'whatsapp',
    created_at:row.created_at,
    updated_at:row.updated_at,
    batch_id:row.metadata?.batch_id||null,
    message_purpose:clean(row.metadata?.message_purpose,80)||null,
    message_context:row.metadata?.message_context||null,
    whatsappUrl:base?base+'?text='+encodeURIComponent(message):null
   };
  });
  return res.status(200).json({success:true,count:drafts.length,drafts});
 }catch(error){
  console.error('[ARIA] draft queue',error);
  return res.status(500).json({error:'Unable to load WhatsApp drafts right now.'});
 }
});
