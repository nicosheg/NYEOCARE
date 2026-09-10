// pages/api/onboarding.js
import pool from'../../lib/db';
import{withOrg}from'../../lib/apiHelpers';

const REQUIRED_EXPERIENCES=['home','scan','people','review','profile'];
const ALLOWED_EXPERIENCES=[...REQUIRED_EXPERIENCES,'person-journey'];

function normalizeExperienced(value){
const source=value&&typeof value==='object'?value:{};
return{...source,home:source.home===true,scan:source.scan===true,people:source.people===true,review:source.review===true,profile:source.profile===true,'person-journey':source['person-journey']===true};
}

function organizationOnboarding(settings){
const onboarding=settings?.onboarding;
if(!onboarding||onboarding.enabled!==true)return{enabled:false};
return{enabled:true};
}

async function handler(req,res){
const orgId=req.org.id;
const userId=req.user.id;

if(req.method==='GET'){
try{
const result=await pool.query(
`SELECT o.settings,o.aria_instructions,o.onboarding_completed_at,u.onboarding_experienced
 FROM public.organizations o
 INNER JOIN public.users u ON u.id=$2 AND u.organization_id=o.id
 WHERE o.id=$1
 LIMIT 1`,
[orgId,userId]
);
if(!result.rows.length)return res.status(404).json({error:'Organization not found'});
const row=result.rows[0];
const organization=organizationOnboarding(row.settings);
const experienced=normalizeExperienced(row.onboarding_experienced);
const completed=REQUIRED_EXPERIENCES.every(key=>experienced[key]);
return res.status(200).json({
onboarding:{enabled:organization.enabled,experienced,completed},
ariaInstructions:row.aria_instructions||'',
onboardingCompletedAt:row.onboarding_completed_at
});
}catch(error){
console.error('[ONBOARDING] GET error:',error);
return res.status(500).json({error:'Unable to load onboarding state'});
}
}

if(req.method==='POST'){
const{action,experience,ariaInstructions}=req.body||{};
try{
const result=await pool.query(
`SELECT settings,aria_instructions,onboarding_completed_at
 FROM public.organizations
 WHERE id=$1
 LIMIT 1`,
[orgId]
);
if(!result.rows.length)return res.status(404).json({error:'Organization not found'});
const organization=organizationOnboarding(result.rows[0].settings);

if(action==='experience_completed'){
if(!organization.enabled)return res.status(200).json({success:true,onboarding:{enabled:false,completed:true}});
if(!ALLOWED_EXPERIENCES.includes(experience))return res.status(400).json({error:'Invalid onboarding experience'});

const current=await pool.query(
`SELECT onboarding_experienced FROM public.users WHERE id=$1 AND organization_id=$2 AND active=true LIMIT 1`,
[userId,orgId]
);
if(!current.rows.length)return res.status(404).json({error:'User not found'});

const experienced=normalizeExperienced(current.rows[0].onboarding_experienced);
experienced[experience]=true;
const completed=REQUIRED_EXPERIENCES.every(key=>experienced[key]);

await pool.query(
`UPDATE public.users
 SET onboarding_experienced=$1::jsonb,updated_at=NOW()
 WHERE id=$2 AND organization_id=$3 AND active=true`,
[JSON.stringify(experienced),userId,orgId]
);

return res.status(200).json({success:true,onboarding:{enabled:true,experienced,completed}});
}

if(action==='save_aria_instructions'){
if(ariaInstructions!==null&&ariaInstructions!==undefined&&typeof ariaInstructions!=='string'){
return res.status(400).json({error:'ARIA instructions must be text'});
}
const cleaned=typeof ariaInstructions==='string'?ariaInstructions.trim():'';
if(cleaned.length>2000)return res.status(400).json({error:'ARIA instructions must be 2000 characters or less'});
await pool.query(
`UPDATE public.organizations
 SET aria_instructions=$1,updated_at=NOW()
 WHERE id=$2`,
[cleaned||null,orgId]
);
return res.status(200).json({success:true,ariaInstructions:cleaned});
}

return res.status(400).json({error:'Invalid onboarding action'});
}catch(error){
console.error('[ONBOARDING] POST error:',error);
return res.status(500).json({error:'Unable to update onboarding state'});
}
}

return res.status(405).json({error:'Method not allowed'});
}

export default withOrg(handler);
