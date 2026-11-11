// components/WorkToday.js
import OperatorSupportRequest from './OperatorSupportRequest';

const kindLabel=item=>{
 if(item?.task_kind==='follow_up')return'FOLLOW-UP';
 if(item?.task_kind==='scan_review')return'REVIEW';
 if(item?.task_kind==='internal_message')return'MESSAGE';
 if(item?.task_kind==='observation')return'SIGNAL';
 if(item?.task_kind==='action')return'CARE';
 return'NEXT STEP';
};

export default function WorkToday({data,role,onOpenItem,onOpenCareOversight}){
 const queue=data?.queue||{},items=Array.isArray(queue.items)?queue.items:(data?.briefing?.items||[]);
 const count=Number(queue.todayCount??items.length)||0,later=Number(queue.laterCount)||0;
 const championName=data?.operator_champion?.name||null;
 return <section className="workToday" aria-labelledby="work-today-heading">
  <header className="workHeader">
   <div className="workHeading"><span className="workEyebrow">YOUR WORK TODAY</span><h2 id="work-today-heading">What needs you?</h2><p>{count?count+' '+(count===1?'thing':'things')+' ready for today.':'Your day is clear for now.'}</p></div>
   {['owner','admin'].includes(role)&&<button className="oversightLink" onClick={onOpenCareOversight}>Care Oversight <span>↗</span></button>}
  </header>
  {items.length>0?<div className="workList">
   {items.slice(0,3).map((item,index)=>{
    const title=item.title||'A responsibility needs attention';
    return <article className="workItem" key={item.queue_item_id||item.id||index}>
     <button className="workItemOpen" onClick={()=>onOpenItem(item)} aria-label={'Open '+title}>
      <span className="workItemContent">
       <span className="workItemHead"><span className="workItemType">{kindLabel(item)}</span><strong>{title}</strong></span>
       {item.message&&<span className="workItemMessage">{item.message}</span>}
      </span>
      <span className="workItemArrow" aria-hidden="true">→</span>
     </button>
     {role==='user'&&item.queue_item_id&&item.task_kind!=='internal_message'&&<div className="workItemHelp"><OperatorSupportRequest queueItemId={item.queue_item_id} championName={championName}/></div>}
    </article>;
   })}
  </div>:<div className="workEmpty">
   <span className="workEmptyLine"/>
   <strong>Nothing needs your attention today.</strong>
   <p>{later?'Your next responsibilities are already scheduled. You do not need to keep the app open.':'You can step away. NYEOCARE will show the next responsibility when it is due.'}</p>
  </div>}
  <footer className="workFooter">
   <span>Today for you · {count}</span><span>Scheduled later · {later}</span>
  </footer>
  <style jsx>{`
   .workToday{box-sizing:border-box;width:100%;margin:5px 0 10px;padding:11px 12px 9px;border-radius:20px;border:1px solid rgba(255,255,255,.09);background:linear-gradient(145deg,rgba(255,255,255,.048),rgba(255,255,255,.015));box-shadow:0 12px 30px rgba(0,0,0,.10)}
   .workHeader{display:flex;align-items:center;justify-content:space-between;min-width:0;margin-bottom:8px}
   .workHeading{flex:1;min-width:0}
   .workEyebrow{font-size:8px;letter-spacing:.19em;color:var(--ny-gold);font-weight:700}
   h2{margin:4px 0 2px;color:var(--ny-text);font-size:18px;line-height:1.15;letter-spacing:-.025em;font-weight:620}
   .workHeader p{margin:0;color:var(--ny-text-muted);font-size:10px;line-height:1.35}
   .oversightLink{min-height:44px;flex-shrink:0;margin-left:8px;border:1px solid rgba(214,184,106,.20);border-radius:999px;background:rgba(214,184,106,.055);color:var(--ny-gold-soft);font-size:9px;font-weight:650;padding:0 9px;white-space:nowrap;cursor:pointer}
   .oversightLink span{padding-left:2px}
   .workList{display:flex;flex-direction:column;min-width:0}
   .workItem{box-sizing:border-box;min-width:0;padding:7px 9px;border:1px solid var(--ny-border-subtle);border-radius:13px;background:rgba(4,10,21,.18)}
   .workItem+.workItem{margin-top:6px}
   .workItemOpen{box-sizing:border-box;width:100%;min-width:0;min-height:44px;display:flex;align-items:center;padding:0;border:0;background:transparent;color:var(--ny-text);text-align:left;cursor:pointer}
   .workItemContent{display:flex;flex:1;flex-direction:column;justify-content:center;min-width:0;margin-right:8px}
   .workItemHead{display:flex;align-items:center;min-width:0;line-height:1.3}
   .workItemType{flex-shrink:0;margin-right:7px;font-size:7.5px;letter-spacing:.11em;color:var(--ny-aria);font-weight:800}
   .workItemOpen strong{display:block;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;font-weight:650;line-height:1.3}
   .workItemMessage{display:block;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:3px;font-size:9.5px;color:var(--ny-text-muted);line-height:1.35}
   .workItemArrow{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:26px;height:26px;border:1px solid rgba(255,255,255,.08);border-radius:50%;color:var(--ny-aria);font-size:15px;line-height:1}
   .workItemHelp{padding-top:4px}
   .workEmpty{padding:14px 8px 12px;display:flex;flex-direction:column;align-items:center;text-align:center}
   .workEmptyLine{width:34px;height:1px;margin-bottom:10px;background:linear-gradient(90deg,transparent,rgba(214,184,106,.45),transparent)}
   .workEmpty strong{font-size:11.5px;color:var(--ny-text);font-weight:600}
   .workEmpty p{max-width:290px;margin:5px 0 0;color:var(--ny-text-muted);font-size:9.5px;line-height:1.45}
   .workFooter{display:flex;align-items:center;flex-wrap:wrap;padding-top:8px;margin-top:8px;border-top:1px solid var(--ny-border-subtle);color:var(--ny-text-whisper);font-size:8px;line-height:1.3}
   .workFooter span{margin-right:11px}
   @media(max-width:400px){
    .workToday{padding:10px 9px 8px;border-radius:17px}
    h2{font-size:16px}
    .oversightLink{padding:0 8px;font-size:8px}
    .workItem{padding:6px 7px}
    .workItemContent{margin-right:6px}
    .workItemType{margin-right:5px;font-size:7px;letter-spacing:.08em}
    .workItemOpen strong{font-size:11px}
    .workItemMessage{font-size:9px}
    .workItemArrow{width:24px;height:24px}
    .workFooter span{margin-right:8px}
   }
   @media(max-width:340px){
    .workHeader{align-items:flex-start}
    .workHeading{padding-top:2px}
    .workEyebrow{font-size:7px;letter-spacing:.15em}
    .oversightLink{margin-left:4px;padding:0 6px;font-size:7.5px}
    .workItemHead{min-width:0}
    .workItemType{margin-right:4px;letter-spacing:.06em}
   }
  `}</style>
 </section>;
}
