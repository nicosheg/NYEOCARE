import crypto from 'node:crypto';

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidPersonCreateRequestId(value){
 return typeof value==='string'&&UUID_RE.test(value);
}

export function hashPersonCreatePayload({first_name,last_name,display_name,phone,email,type,birthday}){
 const canonical={
  first_name:String(first_name||'').trim(),
  last_name:String(last_name||'').trim(),
  display_name:String(display_name||'').trim(),
  phone:phone||null,
  email:email?String(email).trim().toLowerCase():null,
  type:String(type||'visitor').trim().toLowerCase(),
  birthday:birthday||null
 };
 return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
