import pool from'../db';

const clean=(v,max=1000)=>String(v??'').trim().slice(0,max);

export async function loadConversationState(conversationId){
 if(!conversationId)return null;
 const r=await pool.query(`SELECT metadata FROM aria_messages WHERE conversation_id=$1 AND role='assistant' ORDER BY created_at DESC LIMIT 1`,[conversationId]);
 const metadata=r.rows[0]?.metadata;
 return metadata&&typeof metadata.conversation_state==='object'?metadata.conversation_state:null;
}

export function buildConversationState({result,intent=null,goal=null,previous=null}={}){
 const state={
  version:1,
  intent:intent||result?.plan?.goal||previous?.intent||null,
  goal:goal||result?.plan?.goal||previous?.goal||null,
  result_type:result?.type||null,
  referenced_people:[],
  referenced_observations:[],
  referenced_actions:[],
  cohort:null,
  director:previous?.director||null,
  pending_clarification:null,
  updated_at:new Date().toISOString()
 };
 const people=new Map();
 const observations=new Map();
 const actions=new Map();
 for(const item of result?.results||[]){
  for(const p of item?.people||[]){if(p?.id)people.set(String(p.id),{id:p.id,name:clean(p.display_name||p.name||[p.first_name,p.last_name].filter(Boolean).join(' '),160)})}
  for(const p of item?.results||[]){if(p?.id&&('first_name'in p||'display_name'in p))people.set(String(p.id),{id:p.id,name:clean(p.display_name||[p.first_name,p.last_name].filter(Boolean).join(' '),160)})}
  for(const x of item?.items||[]){
   if(x?.person_id)people.set(String(x.person_id),{id:x.person_id,name:clean(x.person_name,160)});
   if(x?.observation_id)observations.set(String(x.observation_id),{id:x.observation_id,person_id:x.person_id||null,person_name:clean(x.person_name||'',160),type:clean(x.observation_type||x.signal_type||'',120)});
   if(x?.action_id)actions.set(String(x.action_id),{id:x.action_id,person_id:x.person_id||null,type:clean(x.action_type||'',120)});
  }
  for(const x of item?.attention||[]){if(x?.person_id)people.set(String(x.person_id),{id:x.person_id,name:clean(x.person_name,160)})}
  for(const x of item?.observations||[]){if(x?.id)observations.set(String(x.id),{id:x.id,person_id:x.person_id||null,person_name:clean(x.person_name||'',160),type:clean(x.type,120)})}
  if(item?.observation_id)observations.set(String(item.observation_id),{id:item.observation_id,person_id:item.person_id||null,person_name:clean(item.person_name||'',160),type:clean(item.type||item.observation_type||'',120)});
  for(const x of item?.actions||[]){if(x?.id)actions.set(String(x.id),{id:x.id,person_id:x.person_id||null,type:clean(x.type,120)})}
  if(item?.action_id)actions.set(String(item.action_id),{id:item.action_id,person_id:item.person_id||null,type:clean(item.type||'',120)});
  if(item?.action?.id)actions.set(String(item.action.id),{id:item.action.id,person_id:item.action.person_id||null,type:clean(item.action.type||'',120)});
  if(item?.capability==='get_director_briefing'){
   const b=item.briefing||{},d=b.decisions||{},i=b.intelligence||{};
   state.director={
    active:true,
    primary_focus:b.primary_focus||null,
    insight:i.insight||b.insight||null,
    contradictions:Array.isArray(i.contradictions)?i.contradictions.slice(0,6):[],
    updated_at:new Date().toISOString()
   };
   for(const x of [...(Array.isArray(d.human_focus)?d.human_focus:[]),...(Array.isArray(d.opportunities)?d.opportunities:[]),...(Array.isArray(d.watchlist)?d.watchlist:[])]){
    if(x?.person_id&&!people.has(String(x.person_id)))people.set(String(x.person_id),{id:x.person_id,name:clean(x.name||x.person_name||'',160)});
    if(x?.observation_id)observations.set(String(x.observation_id),{id:x.observation_id,person_id:x.person_id||null,person_name:clean(x.name||'',160),type:clean(x.observation||'',120)});
    if(x?.action_id)actions.set(String(x.action_id),{id:x.action_id,person_id:x.person_id||null,type:clean(x.action||'',120)});
   }
  }
  if(item?.cohort)state.cohort=item.cohort;
  if(item?.cohort_key)state.cohort={key:item.cohort_key,count:Number(item.count)||0,person_ids:Array.isArray(item.person_ids)?item.person_ids.slice(0,50):[]};
 }
 if(result?.action?.id)actions.set(String(result.action.id),{id:result.action.id,person_id:result.action.person_id||null,type:clean(result.action.type||'',120)});
 if(result?.type==='clarification')state.pending_clarification={text:clean(result.text,600),matches:Array.isArray(result.matches)?result.matches.slice(0,10):[]};
 state.referenced_people=[...people.values()].slice(0,50);
 state.referenced_observations=[...observations.values()].slice(0,50);
 state.referenced_actions=[...actions.values()].slice(0,50);
 if(!state.referenced_people.length&&previous?.referenced_people?.length)state.referenced_people=previous.referenced_people.slice(0,50);
 if(!state.referenced_observations.length&&previous?.referenced_observations?.length)state.referenced_observations=previous.referenced_observations.slice(0,50);
 if(!state.referenced_actions.length&&previous?.referenced_actions?.length)state.referenced_actions=previous.referenced_actions.slice(0,50);
 return state;
}

export async function persistConversationState(messageId,state,extraMetadata={}){
 if(!messageId)return;
 await pool.query(`UPDATE aria_messages SET metadata=COALESCE(metadata,'{}'::jsonb)||$2::jsonb WHERE id=$1`,[messageId,JSON.stringify({...extraMetadata,conversation_state:state})]);
}
