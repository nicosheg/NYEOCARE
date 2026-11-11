// components/WorkToday.js
import OperatorSupportRequest from './OperatorSupportRequest';

const kindLabel=item=>{
 if(item?.task_kind==='follow_up')return'CARE FOLLOW-UP';
 if(item?.task_kind==='scan_review')return'REVIEW';
 if(item?.task_kind==='internal_message')return'MESSAGE';
 if(item?.task_kind==='observation')return'OBSERVATION';
 return'RESPONSIBILITY';
};

export default function WorkToday({data,role,onOpenItem,onOpenAll,onOpenCareOversight}){
 const queue=data?.queue||{},items=Array.isArray(queue.items)?queue.items:(data?.briefing?.items||[]);
 const count=Number(queue.todayCount??items.length)||0,later=Number(queue.laterCount)||0;
 const championName=data?.operator_champion?.name||null;
 return <section className="workToday" aria-labelledby="work-today-heading">
  <header className="workHeader">
   <div><span className="workEyebrow">YOUR WORK TODAY</span><h2 id="work-today-heading">What needs you?</h2><p>{count?count+' '+(count===1?'thing':'things')+' ready for today.':'Your day is clear for now.'}</p></div>
   {['owner','admin'].includes(role)&&<button className="oversightLink" onClick={onOpenCareOversight}>Care Oversight <span>↗</span></button>}
  </header>
  {items.length>0?<div className="workList">
   {items.slice(0,3).map((item,index)=><article className="workItem" key={item.queue_item_id||item.id||index}>
    <button className="workItemOpen" onClick={()=>onOpenItem(item)} aria-label={'Open '+(item.title||'responsibility')}>
     <span className="workItemType">{kindLabel(item)}</span>
     <strong>{item.title||'A responsibility needs attention'}</strong>
     {item.message&&<span className="workItemMessage">{item.message}</span>}
     <span className="workItemAction">Open responsibility <b>→</b></span>
    </button>
    {role==='user'&&item.queue_item_id&&item.task_kind!=='internal_message'&&<div className="workItemHelp"><OperatorSupportRequest queueItemId={item.queue_item_id} championName={championName}/></div>}
   </article>)}
  </div>:<div className="workEmpty">
   <span className="workEmptyLine"/>
   <strong>Nothing needs your attention today.</strong>
   <p>{later?'Your next responsibilities are already scheduled. You do not need to keep the app open.':'You can step away. NYEOCARE will show the next responsibility when it is due.'}</p>
  </div>}
  <footer className="workFooter">
   <span>Today for you · {count}</span><span>Scheduled later · {later}</span>
   {count>3&&<button onClick={onOpenAll}>Open ARIA Today →</button>}
  </footer>
  <style jsx>{`
   .workToday{width:100%;margin:6px 0 15px;padding:16px 15px 12px;border-radius:23px;border:1px solid rgba(255,255,255,.09);background:linear-gradient(145deg,rgba(255,255,255,.048),rgba(255,255,255,.015));box-shadow:0 18px 46px rgba(0,0,0,.12)}
   .workHeader{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:11px}
   .workEyebrow{font-size:8px;letter-spacing:.21em;color:var(--ny-gold);font-weight:700}
   h2{margin:5px 0 3px;color:var(--ny-text);font-size:19px;line-height:1.18;letter-spacing:-.025em;font-weight:620}
   .workHeader p{margin:0;color:var(--ny-text-muted);font-size:10px}
   .oversightLink{border:1px solid rgba(214,184,106,.20);border-radius:999px;background:rgba(214,184,106,.055);color:var(--ny-gold-soft);font-size:9px;font-weight:650;padding:8px 10px;white-space:nowrap;cursor:pointer}
   .oversightLink span{padding-left:3px}
   .workList{display:grid;gap:8px}
   .workItem{min-width:0;padding:11px 12px;border:1px solid var(--ny-border-subtle);border-radius:15px;background:rgba(4,10,21,.18)}
   .workItemOpen{width:100%;display:grid;gap:5px;padding:0;border:0;background:transparent;color:var(--ny-text);text-align:left;cursor:pointer}
   .workItemType{font-size:8px;letter-spacing:.15em;color:var(--ny-aria);font-weight:700}
   .workItemOpen strong{font-size:12px;font-weight:650;line-height:1.35}
   .workItemMessage{font-size:10px;color:var(--ny-text-muted);line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
   .workItemAction{display:flex;justify-content:space-between;align-items:center;margin-top:3px;color:var(--ny-aria);font-size:9px;font-weight:650}
   .workItemAction b{font-size:13px;font-weight:500}
   .workItemHelp{padding-top:3px}
   .workEmpty{padding:18px 8px 15px;display:grid;justify-items:center;text-align:center}
   .workEmptyLine{width:38px;height:1px;margin-bottom:13px;background:linear-gradient(90deg,transparent,rgba(214,184,106,.45),transparent)}
   .workEmpty strong{font-size:12px;color:var(--ny-text);font-weight:600}
   .workEmpty p{max-width:290px;margin:6px 0 0;color:var(--ny-text-muted);font-size:10px;line-height:1.5}
   .workFooter{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding-top:10px;margin-top:9px;border-top:1px solid var(--ny-border-subtle);color:var(--ny-text-whisper);font-size:8.5px}
   .workFooter button{margin-left:auto;border:0;padding:0;background:transparent;color:var(--ny-aria);font-size:9px;font-weight:650;cursor:pointer}
   @media(max-width:400px){.workToday{padding:14px 12px 11px}.workHeader{align-items:flex-start}.workHeader h2{font-size:18px}.oversightLink{padding:7px 8px;font-size:8px}.workFooter{gap:8px}}
  `}</style>
 </section>;
}
