// lib/aria/continuityEngine.js
import pool from'../db';
import{getMemory}from'./organizationMemory';
import{getOrganizationChanges}from'./temporalEngine';

const clean=(v,max=1200)=>String(v??'').trim().slice(0,max);
const cap=(v,d=20,max=80)=>Math.min(Math.max(Number(v)||d,1),max);

async function requireActor(organizationId,actorId){
 const r=await pool.query("SELECT id,name,role FROM users WHERE id=$1 AND organization_id=$2 AND active=true LIMIT 1",[actorId,organizationId]);
 if(!r.rows.length)throw Object.assign(new Error('Authenticated organization actor required.'),{status:403});
 return r.rows[0];
}

export async function getAriaContinuity({organizationId,actorId,currentConversationId=null,personId=null,scope='conversation',limit=20}={}){
 if(!organizationId||!actorId)throw Object.assign(new Error('Organization continuity requires an authenticated operator.'),{status:401});
 const actor=await requireActor(organizationId,actorId);
 const n=cap(limit,20,80);
 const mode=scope==='full'?'full':'conversation';

 const conversations=(await pool.query(
  "SELECT c.id,c.person_id,c.created_at,c.updated_at,COALESCE(p.display_name,TRIM(CONCAT_WS(' ',p.first_name,p.last_name)),'Organization') AS person_name,COALESCE((SELECT LEFT(m.content,400) FROM aria_messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1),'Conversation') AS preview FROM aria_conversations c LEFT JOIN people p ON p.id=c.person_id AND p.organization_id=c.organization_id WHERE c.organization_id=$1 AND c.status='active' AND(c.user_id=$2 OR c.user_id IS NULL) AND($3::text IS NULL OR c.id::text<>$3::text) AND($4::text IS NULL OR c.person_id::text=$4::text) ORDER BY c.updated_at DESC NULLS LAST LIMIT $5",
  [organizationId,actorId,currentConversationId?String(currentConversationId):null,personId?String(personId):null,n])).rows;

 const conversationIds=conversations.map(x=>x.id);
 let messages=[];
 if(conversationIds.length){
  messages=(await pool.query(
   "SELECT conversation_id,id,role,content,created_at FROM(SELECT m.*,ROW_NUMBER() OVER(PARTITION BY m.conversation_id ORDER BY m.created_at DESC,m.id DESC) AS rn FROM aria_messages m WHERE m.conversation_id=ANY($1::uuid[]))x WHERE rn<=8 ORDER BY conversation_id,created_at ASC,id ASC",
   [conversationIds])).rows;
 }
 const byConversation=new Map();
 for(const m of messages){const list=byConversation.get(String(m.conversation_id))||[];list.push({id:m.id,role:m.role,content:clean(m.content,1200),created_at:m.created_at});byConversation.set(String(m.conversation_id),list)}
 const conversationHistory=conversations.map(c=>({id:c.id,person_id:c.person_id||null,person_name:c.person_name||'Organization',created_at:c.created_at,updated_at:c.updated_at,preview:clean(c.preview,400),messages:byConversation.get(String(c.id))||[]}));
 const memoryRows=await getMemory(organizationId,null,null,{currentOnly:true,limit:mode==='full'?80:20});
 const last=conversationHistory[0]||null;

 if(mode!=='full')return{capability:'get_aria_continuity',scope:'conversation',viewer:{name:actor.name,role:actor.role},last_conversation:last,previous_conversations:conversationHistory.slice(0,8),durable_organization_memory:memoryRows.map(x=>({memory_type:x.memory_type,key:x.memory_key,value:x.memory_value,confidence:x.confidence,evidence_kind:x.evidence_kind,verification_status:x.verification_status,updated_at:x.updated_at}))};

 const [changes,present,future]=await Promise.all([
  getOrganizationChanges(organizationId,{days:180,limit:Math.min(n*2,60)}),
  (async()=>{
   const [people,activeSession,openTasks,pendingActions,activeGroups]=await Promise.all([
    pool.query("SELECT COUNT(*)::int count FROM people WHERE organization_id=$1 AND COALESCE(status,'active')='active'",[organizationId]),
    pool.query("SELECT id,name,status,started_at FROM sessions WHERE organization_id=$1 AND status='active' ORDER BY started_at DESC NULLS LAST LIMIT 1",[organizationId]),
    pool.query("SELECT id,person_id,title,description,status,priority,due_at,assigned_to,created_at FROM person_tasks WHERE organization_id=$1 AND status NOT IN('completed','cancelled') ORDER BY due_at NULLS LAST,created_at DESC LIMIT $2",[organizationId,Math.min(n,40)]),
    pool.query("SELECT id,person_id,type,status,priority,proposed_at,expires_at,action_metadata FROM aria_actions WHERE organization_id=$1 AND status IN('proposed','approved','executing') ORDER BY proposed_at DESC LIMIT $2",[organizationId,Math.min(n,40)]),
    pool.query("SELECT g.id,g.name,COUNT(DISTINCT pm.person_id) FILTER(WHERE pm.status='active')::int member_count FROM organization_groups g LEFT JOIN person_memberships pm ON pm.organization_id=g.organization_id AND pm.group_id=g.id WHERE g.organization_id=$1 AND g.active=true GROUP BY g.id ORDER BY g.name LIMIT 50",[organizationId])
   ]);
   return{people_count:Number(people.rows[0]?.count)||0,active_session:activeSession.rows[0]||null,open_tasks:openTasks.rows,pending_actions:pendingActions.rows,active_groups:activeGroups.rows};
  })(),
  (async()=>{
   const [futureTasks,futureSessions,futureMemory]=await Promise.all([
    pool.query("SELECT pt.id,pt.person_id,pt.title,pt.description,pt.priority,pt.status,pt.due_at FROM person_tasks pt WHERE pt.organization_id=$1 AND pt.status NOT IN('completed','cancelled') AND pt.due_at IS NOT NULL AND pt.due_at>NOW() ORDER BY pt.due_at ASC LIMIT $2",[organizationId,Math.min(n,40)]),
    pool.query("SELECT id,name,status,service_type,started_at,event_kind,event_scope FROM sessions WHERE organization_id=$1 AND started_at>NOW() ORDER BY started_at ASC LIMIT $2",[organizationId,Math.min(n,40)]),
    pool.query("SELECT memory_type,memory_key,memory_value,confidence,evidence_kind,verification_status,valid_from,valid_until,updated_at FROM organization_memory WHERE organization_id=$1 AND is_current=true AND valid_from>NOW() ORDER BY valid_from ASC LIMIT $2",[organizationId,Math.min(n,40)])
   ]);
   return{tasks:futureTasks.rows,sessions:futureSessions.rows,memory:futureMemory.rows};
  })()
 ]);

 return{capability:'get_aria_continuity',scope:'full',viewer:{name:actor.name,role:actor.role},last_conversation:last,previous_conversations:conversationHistory.slice(0,12),durable_organization_memory:memoryRows.map(x=>({memory_type:x.memory_type,key:x.memory_key,value:x.memory_value,confidence:x.confidence,evidence_kind:x.evidence_kind,verification_status:x.verification_status,valid_until:x.valid_until,updated_at:x.updated_at})),past:{history_window_days:180,organization_changes:changes.highlights,change_counts:changes.counts},present,future,generated_at:new Date().toISOString()};
}