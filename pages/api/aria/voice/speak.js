// pages/api/aria/voice/speak.js
import{withOrg}from'../../../../lib/apiHelpers';
import{synthesizeSpeech}from'../../../../lib/aiGateway';

const voices=new Set(['autumn','diana','hannah','austin','daniel','troy']);

export default withOrg(async function handler(req,res){
 if(req.method!=='POST'){
  res.setHeader('Allow','POST');
  return res.status(405).json({error:'Method not allowed'});
 }
 try{
  const{text,voice='hannah'}=req.body||{};
  if(!text||typeof text!=='string')return res.status(400).json({error:'Text required'});
  const input=text.trim();
  if(!input)return res.status(400).json({error:'Text required'});
  if(input.length>200)return res.status(400).json({error:'Speech text must be 200 characters or fewer.'});
  if(!voices.has(String(voice).toLowerCase()))return res.status(400).json({error:'Unsupported ARIA voice.'});
  const result=await synthesizeSpeech({text:input,voice:String(voice).toLowerCase(),organizationId:req.org.id});
  if(!result?.buffer?.length)return res.status(502).json({error:'ARIA speech returned no audio.'});
  res.setHeader('Content-Type',result.mimeType||'audio/wav');
  res.setHeader('Content-Length',result.buffer.length);
  res.setHeader('Cache-Control','no-store');
  return res.status(200).end(result.buffer);
 }catch(err){
  console.error('[ARIA] Speech error:',err);
  return res.status(err.status||500).json({error:err.message||'Unable to generate speech.'});
 }
});
