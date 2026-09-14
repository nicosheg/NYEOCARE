// pages/api/auth/diagnose-login.js
import pool from '../../../lib/db';

export default async function handler(req,res){
if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
const email=String(req.body?.email||'').trim().toLowerCase();
if(!email||email.length>320||!email.includes('@'))return res.status(400).json({error:'Please enter a valid email address.'});
try{
const result=await pool.query('SELECT 1 FROM auth.users WHERE lower(email)=lower($1) LIMIT 1',[email]);
return res.status(200).json({accountExists:result.rowCount>0});
}catch(error){
console.error('[AUTH] Login diagnosis failed:',error?.message||error);
return res.status(503).json({error:'Unable to check the account right now.'});
}
}
