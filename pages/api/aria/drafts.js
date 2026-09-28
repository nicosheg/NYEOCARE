// pages/api/aria/drafts.js
import{withOrg}from'../../../lib/apiHelpers';
import pool from'../../../lib/db';
import{normalizeWhatsAppPhone,whatsappChatUrl,getAddressName}from'../../../lib/aria/whatsapp.js';

const clean=(v,max=300)=>String(v??'').trim().slice(0,max);
const DRAFT_VERSION='whatsapp_v2';

export default withOrg(async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 try{
  const limit=Math.min(Math.max(Number(req.query?.limit)||100,1),200);
  const result=await pool.query(
   `SELECT c.id,c.person_id,c.channel,c.status,c.subject,c.content,c.metadata,c.created_at,c.updated_at,
           p.display_name,p.first_name,p.last_name,p.phone,p.phone_numbers,p.metadata AS person_metadata
    FROM person_communications c
    JOIN people p ON p.id=c.person_id AND p.organization_id=c.organization_id
    WHERE c.organization_id=$1 AND c.direction='outbound' AND c.status='draft'
      AND c.channel='whatsapp'
      AND c.metadata->>'draft_version'=$2
      AND p.status='active'
    ORDER BY c.created_at DESC
    LIMIT $3`,
   [req.org.id,DRAFT_VERSION,limit]
  );
  const drafts=[],needsPhoneReview=[];
  for(const row of result.rows){
   const rawPhone=row.metadata?.phone||row.phone||((Array.isArray(row.phone_numbers)&&row.phone_numbers[0]?.normalized)||((Array.isArray(row.phone_numbers)&&row.phone_numbers[0]?.raw)||null));
   const normalized=normalizeWhatsAppPhone(rawPhone);
   const person={display_name:row.display_name,first_name:row.first_name,last_name:row.last_name,metadata:row.person_metadata||{}};
   const item={
    id:row.id,
    person_id:row.person_id,
    name:getAddressName(person),
    message:String(row.content||'').trim(),
    phone:rawPhone||null,
    channel:'whatsapp',
    created_at:row.created_at,
    updated_at:row.updated_at,
    batch_id:row.metadata?.batch_id||null,
    message_purpose:clean(row.metadata?.message_purpose,80)||null,
    message_context:row.metadata?.message_context||null,
    whatsappReady:normalized.valid,
    whatsappUrl:whatsappChatUrl(rawPhone,String(row.content||'').trim())
   };
   if(normalized.valid)drafts.push(item);
   else needsPhoneReview.push({...item,whatsappReady:false,whatsappUrl:null,reason:normalized.reason||'invalid_phone'});
  }
  return res.status(200).json({
   success:true,
   draft_version:DRAFT_VERSION,
   count:drafts.length,
   ready_count:drafts.length,
   needs_phone_review_count:needsPhoneReview.length,
   drafts,
   needs_phone_review:needsPhoneReview
  });
 }catch(error){
  console.error('[ARIA] draft queue',error);
  return res.status(500).json({error:'Unable to load WhatsApp drafts right now.'});
 }
});
