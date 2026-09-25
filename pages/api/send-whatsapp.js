// pages/api/send-whatsapp.js
// Compatibility endpoint. ARIA now uses organization-scoped care drafting and structured communication outcomes.
import{withOrg}from'../../lib/apiHelpers';
import{createCareDraft}from'../../lib/aria/draftEngine';
import{recordCommunicationOutcome}from'../../lib/aria/communicationOutcome';
import pool from'../../lib/db';

export default withOrg(async function handler(req,res){
 if(req.method!=='POST')return res.status(405).end();
 const{person_id,confirm=false,action_id=null}=req.body||{};
 if(!person_id)return res.status(400).json({error:'Missing person_id'});
 try{
  const person=(await pool.query(`SELECT id,display_name,first_name,phone FROM people WHERE id=$1 AND organization_id=$2 AND COALESCE(status,'active')='active' LIMIT 1`,[person_id,req.org.id])).rows[0];
  if(!person)return res.status(404).json({error:'Person not found'});
  const draft=await createCareDraft({organizationId:req.org.id,personId:person.id,actionId:action_id||null,actorId:req.user.id});
  if(confirm===true){
   const sent=await recordCommunicationOutcome({organizationId:req.org.id,personId:person.id,channel:'whatsapp',direction:'outbound',status:'sent',content:draft.message,externalId:`manual:${draft.communication.id}`,actorId:req.user.id,actionId:action_id||null,metadata:{source:'compatibility_endpoint',manual_confirmation:true,draft_communication_id:draft.communication.id}});
   return res.status(200).json({success:true,communication:sent.communication,event:sent.event});
  }
  return res.status(200).json({draft:draft.message,wa_link:draft.whatsappUrl,communication:draft.communication,requires_human_send:true});
 }catch(err){
  console.error('Send WhatsApp error:',err);
  return res.status(err.status||500).json({error:err.message||'Unable to prepare WhatsApp care message.'});
 }
});