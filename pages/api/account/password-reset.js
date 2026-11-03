// pages/api/account/password-reset.js
import { supabase } from '../../../lib/supabaseClient';
import { getCurrentCareUser } from '../../../lib/auth';

export default async function handler(req,res){
if(req.method!=='POST')return res.status(405).json({error:'Method not allowed.'});

const user=await getCurrentCareUser(req);
if(!user)return res.status(401).json({error:'Unauthorized.'});
if(!user.email)return res.status(400).json({error:'No email address is available for this account.'});

try{
const origin=(process.env.NEXT_PUBLIC_SITE_URL||process.env.NEXT_PUBLIC_APP_URL||'https://nyeocare.vercel.app').replace(/\/$/,'');

const{error}=await supabase.auth.resetPasswordForEmail(user.email,{redirectTo:`${origin.replace(/\/$/,'')}/auth/verify?next=%2Freset-password`});

if(error)return res.status(400).json({error:'Unable to send the password reset email.'});

return res.status(200).json({success:true});
}catch(err){
return res.status(500).json({error:'Unable to send the password reset email.'});
}
}
