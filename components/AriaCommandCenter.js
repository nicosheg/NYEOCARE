// components/AriaCommandCenter.js
import{useEffect,useRef,useState}from'react';
import{useRouter}from'next/router';

export function openAria(detail={}){
 if(typeof window==='undefined')return;
 window.dispatchEvent(new CustomEvent('nyeocare:aria-open',{detail:detail||{}}));
}

export default function AriaCommandCenter(){
 const router=useRouter(),launcherRef=useRef(null),drag=useRef(null),moved=useRef(false);
 const[expanded,setExpanded]=useState(true),[hidden,setHidden]=useState(false),[pos,setPos]=useState({right:18,bottom:18});
 const go=detail=>{const query={};if(detail?.personId)query.personId=String(detail.personId);if(detail?.prompt)query.prompt=String(detail.prompt);router.push({pathname:'/aria',query})};
 useEffect(()=>{const onOpen=e=>go(e?.detail||{});window.addEventListener('nyeocare:aria-open',onOpen);const timer=window.setTimeout(()=>setExpanded(false),6500);return()=>{window.removeEventListener('nyeocare:aria-open',onOpen);window.clearTimeout(timer)}},[]);
 useEffect(()=>{setHidden(router.pathname==='/aria')},[router.pathname]);
 const down=e=>{if(e.pointerType==='mouse'&&e.button!==0)return;drag.current={x:e.clientX,y:e.clientY,right:pos.right,bottom:pos.bottom};moved.current=false;launcherRef.current?.setPointerCapture?.(e.pointerId)};
 const move=e=>{const d=drag.current;if(!d)return;const dx=e.clientX-d.x,dy=e.clientY-d.y;if(!d.moved&&Math.hypot(dx,dy)>6){d.moved=true;moved.current=true}if(!d.moved)return;const w=launcherRef.current?.offsetWidth||50,h=launcherRef.current?.offsetHeight||50;setPos({right:Math.min(Math.max(8,d.right-dx),Math.max(8,window.innerWidth-w-8)),bottom:Math.min(Math.max(8,d.bottom-dy),Math.max(8,window.innerHeight-h-8))});e.preventDefault()};
 const up=e=>{if(drag.current){try{launcherRef.current?.releasePointerCapture?.(e.pointerId)}catch{}drag.current=null}if(moved.current){moved.current=false;return}go({})};
 if(hidden)return null;
 return <button ref={launcherRef} className={'ariaLauncher '+(expanded?'expanded':'')} style={{right:pos.right,bottom:pos.bottom}} onPointerDown={down} onPointerMove={move} onPointerUp={up} onMouseEnter={()=>setExpanded(true)} onFocus={()=>setExpanded(true)} onTouchStart={()=>setExpanded(true)} aria-label="Talk to ARIA"><span className="ariaLauncherOrb">A</span><span className="ariaLauncherText">Talk to ARIA</span><style jsx>{\`
 .ariaLauncher{position:fixed;height:50px;width:50px;padding:4px;border:1px solid rgba(238,248,253,.24);border-radius:999px;background:radial-gradient(circle at 25% 15%,rgba(255,255,255,.35),rgba(143,175,214,.14) 38%,rgba(6,16,30,.86));color:#F5F7FA;display:flex;align-items:center;gap:7px;overflow:hidden;cursor:grab;touch-action:none;box-shadow:0 20px 48px rgba(0,0,0,.34),inset 0 1px 1px rgba(255,255,255,.45);backdrop-filter:blur(18px);transition:width .42s cubic-bezier(.2,.78,.18,1),transform .3s ease}.ariaLauncher.expanded{width:140px}.ariaLauncher:active{cursor:grabbing;transform:scale(.97)}.ariaLauncherOrb{width:40px;height:40px;flex:0 0 40px;border-radius:50%;display:grid;place-items:center;background:radial-gradient(circle at 30% 18%,#fff,rgba(224,239,247,.96) 22%,rgba(143,175,214,.72) 58%,rgba(26,52,74,.98));color:#17334a;font-size:12px;font-weight:800;box-shadow:inset 0 2px 4px rgba(255,255,255,.64),inset 0 -9px 13px rgba(20,49,67,.2),0 5px 14px rgba(0,0,0,.2);transform:rotate(-7deg);transition:transform .42s ease}.ariaLauncher.expanded .ariaLauncherOrb{transform:rotate(4deg)}.ariaLauncherText{max-width:0;opacity:0;white-space:nowrap;font-size:11px;font-weight:700;overflow:hidden;transform:translateX(8px);transition:max-width .35s ease,opacity .22s ease,transform .35s ease}.ariaLauncher.expanded .ariaLauncherText{max-width:90px;opacity:1;transform:none}@media(prefers-reduced-motion:reduce){.ariaLauncher,.ariaLauncherOrb,.ariaLauncherText{transition:none!important}}
 \`}</style></button>
}