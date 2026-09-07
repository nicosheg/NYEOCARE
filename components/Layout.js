// components/Layout.js
import Link from'next/link';
import{useRouter}from'next/router';

export default function Layout({children}){
const router=useRouter();
const isActive=path=>router.pathname===path||(path!=='/'&&router.pathname.startsWith(path));
return <>
<div className="livingCanvas" aria-hidden="true"><div className="skyGlow"/><div className="cloud cloudA"/><div className="cloud cloudB"/><div className="cloud cloudC"/><div className="cloud cloudD"/><div className="skyVignette"/></div>
<div className="ariaBrand" aria-hidden="true">ARIA</div>
<nav className="ariaNav" aria-label="Primary navigation">
<div className="ariaNavInner">
<Link href="/" aria-label="Home" className={`gasBubble homeBubble ${isActive('/')?'active':''}`}><span className="gasCore"/><span className="gasReflection"/><span className="gasIcon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 10.8 12 3.7l8.5 7.1M5.5 9.5v10h13v-10M9.2 19.5v-5.8h5.6v5.8"/></svg></span></Link>
<span className="liquidBridge bridgeLeft" aria-hidden="true"/>
<Link href="/people" aria-label="People" className={`gasBubble ariaBubble ${isActive('/people')?'active':''}`}><span className="gasCore"/><span className="gasReflection"/><span className="gasIcon"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.1"/><path d="M5.7 20c.6-3.7 2.7-5.7 6.3-5.7s5.7 2 6.3 5.7"/></svg></span><span className="ariaHalo"/></Link>
<span className="liquidBridge bridgeRight" aria-hidden="true"/>
<Link href="/profile" aria-label="Profile" className={`gasBubble profileBubble ${isActive('/profile')?'active':''}`}><span className="gasCore"/><span className="gasReflection"/><span className="gasIcon"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.3"/><path d="M5.5 20c.7-3.8 2.8-5.8 6.5-5.8s5.8 2 6.5 5.8"/></svg></span></Link>
</div>
</nav>
<main className="mainContent">{children}</main>
<style jsx global>{`
*{box-sizing:border-box}
.livingCanvas{position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none;background:radial-gradient(ellipse at 50% 8%,rgba(23,46,83,.42),transparent 45%),radial-gradient(ellipse at 15% 65%,rgba(12,31,61,.5),transparent 52%),radial-gradient(ellipse at 85% 35%,rgba(16,35,69,.38),transparent 50%),#050a14}
.skyGlow{position:absolute;inset:-20%;background:radial-gradient(ellipse at 50% 35%,rgba(80,111,157,.08),transparent 48%),radial-gradient(ellipse at 30% 70%,rgba(70,95,145,.045),transparent 45%);animation:skyDrift 42s ease-in-out infinite}
.cloud{position:absolute;width:75vw;height:24vw;min-height:130px;max-height:360px;border-radius:50%;filter:blur(38px);opacity:.105;background:radial-gradient(ellipse at 20% 50%,rgba(154,177,211,.72),transparent 42%),radial-gradient(ellipse at 48% 35%,rgba(106,139,181,.58),transparent 46%),radial-gradient(ellipse at 75% 58%,rgba(143,166,201,.5),transparent 43%)}
.cloudA{top:12%;left:-18%;animation:cloudDrift 48s ease-in-out infinite}
.cloudB{top:38%;right:-25%;opacity:.075;animation:cloudDriftReverse 58s ease-in-out infinite}
.cloudC{bottom:8%;left:-20%;opacity:.08;animation:cloudDrift 65s ease-in-out infinite}
.cloudD{top:62%;right:-25%;opacity:.055;animation:cloudDriftReverse 72s ease-in-out infinite}
.skyVignette{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(2,5,12,.08),rgba(2,5,12,.22)),radial-gradient(ellipse at center,transparent 38%,rgba(2,5,12,.42) 100%)}
.ariaBrand{position:fixed;top:105px;left:50%;transform:translateX(-50%);z-index:2;pointer-events:none;user-select:none;font-size:clamp(42px,11vw,92px);line-height:1;font-weight:700;letter-spacing:.16em;padding-left:.16em;color:rgba(229,236,248,.13);-webkit-text-stroke:1px rgba(255,255,255,.08);text-shadow:0 0 18px rgba(180,205,235,.06),0 0 48px rgba(91,130,180,.045);opacity:.85;animation:ariaBreath 18s ease-in-out infinite}
.ariaNav{position:fixed;top:15px;left:0;right:0;z-index:999;width:100%;height:88px;display:flex;justify-content:center;align-items:center;pointer-events:none;animation:ariaFlight 11s ease-in-out infinite}
.ariaNavInner{position:relative;display:flex;align-items:center;justify-content:center;height:78px;padding:0 6px;pointer-events:auto;filter:drop-shadow(0 15px 24px rgba(0,0,0,.2))}
@keyframes ariaFlight{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(0,-5px,0)}}
.liquidBridge{position:relative;z-index:1;width:43px;height:35px;margin:0 -6px;background:linear-gradient(90deg,rgba(180,210,235,.1),rgba(225,240,255,.28),rgba(180,210,235,.1));border-top:1px solid rgba(235,245,255,.4);border-bottom:1px solid rgba(235,245,255,.1);filter:blur(.25px);box-shadow:inset 0 8px 14px rgba(255,255,255,.07),inset 0 -8px 14px rgba(0,0,0,.14),0 0 12px rgba(150,190,225,.06)}
.bridgeLeft{border-radius:0 50% 50% 0;transform:scaleY(.72)}
.bridgeRight{border-radius:50% 0 0 50%;transform:scaleY(.72)}
.gasBubble{position:relative;z-index:2;width:74px;height:74px;flex:0 0 74px;display:flex;align-items:center;justify-content:center;border-radius:50%;text-decoration:none;overflow:hidden;cursor:pointer;background:radial-gradient(circle at 50% 50%,rgba(255,255,255,.11) 0%,rgba(190,215,240,.08) 34%,rgba(100,140,180,.045) 66%,rgba(255,255,255,.025) 100%);border:1px solid rgba(225,238,252,.3);box-shadow:inset 8px 9px 18px rgba(255,255,255,.15),inset -9px -11px 22px rgba(0,0,0,.2),inset 0 0 20px rgba(145,185,225,.09),0 9px 30px rgba(0,0,0,.24);backdrop-filter:blur(20px) saturate(140%);-webkit-backdrop-filter:blur(20px) saturate(140%);transition:transform .35s cubic-bezier(.2,.8,.2,1),border-color .4s ease,box-shadow .4s ease}
.gasBubble::before{content:"";position:absolute;inset:2px;border-radius:50%;pointer-events:none;background:radial-gradient(ellipse at 33% 22%,rgba(255,255,255,.42),rgba(255,255,255,.1) 19%,transparent 47%);opacity:.78}
.gasBubble::after{content:"";position:absolute;inset:5px;border-radius:50%;pointer-events:none;border:1px solid rgba(255,255,255,.06);box-shadow:inset -4px -5px 10px rgba(0,0,0,.08)}
.gasReflection{position:absolute;width:22%;height:9%;top:19%;left:27%;border-radius:50%;background:rgba(255,255,255,.22);filter:blur(3px);transform:rotate(-22deg);opacity:.65;pointer-events:none}
.gasCore{position:absolute;left:50%;top:50%;width:44%;height:44%;transform:translate(-50%,-50%);border-radius:50%;pointer-events:none;background:radial-gradient(circle,rgba(255,249,211,.98) 0%,rgba(245,214,112,.9) 18%,rgba(212,175,55,.48) 42%,rgba(212,175,55,.12) 65%,transparent 100%);filter:blur(2.5px);opacity:.025;transition:opacity .45s ease,transform .45s ease}
.gasBubble.active .gasCore{opacity:.98;transform:translate(-50%,-50%) scale(1.22)}
.gasBubble.active{border-color:rgba(246,220,132,.68);box-shadow:inset 8px 9px 18px rgba(255,255,255,.17),inset -9px -11px 22px rgba(0,0,0,.16),inset 0 0 28px rgba(212,175,55,.17),0 0 13px rgba(212,175,55,.34),0 0 38px rgba(212,175,55,.18)}
.gasBubble:active{transform:scale(.94)}
.gasIcon{position:relative;z-index:5;width:25px;height:25px;display:flex;align-items:center;justify-content:center;color:rgba(224,235,248,.76);transition:color .35s ease,filter .35s ease,transform .35s ease}
.gasIcon svg{width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round}
.gasBubble.active .gasIcon{color:#fff2bd;filter:drop-shadow(0 0 5px rgba(255,235,160,.8)) drop-shadow(0 0 13px rgba(212,175,55,.48));transform:scale(1.06)}
.ariaBubble{width:78px;height:78px;flex-basis:78px;margin-top:0}
.ariaBubble .gasIcon{width:27px;height:27px}
.ariaHalo{position:absolute;inset:-9px;border-radius:50%;border:1px solid rgba(212,175,55,.04);box-shadow:0 0 22px rgba(212,175,55,.04);pointer-events:none;transition:all .5s ease}
.ariaBubble.active .ariaHalo{inset:-13px;border-color:rgba(212,175,55,.18);box-shadow:0 0 26px rgba(212,175,55,.14),0 0 48px rgba(212,175,55,.07)}
.mainContent{position:relative;z-index:1;width:100%;min-height:100vh;padding:130px max(18px,4vw) 80px}
.fiducia-card{position:relative;overflow:hidden;padding:24px;margin-bottom:18px;border-radius:28px;background:radial-gradient(ellipse at 20% 10%,rgba(255,255,255,.075),transparent 38%),linear-gradient(135deg,rgba(166,195,225,.095),rgba(35,53,78,.075));border:1px solid rgba(220,235,250,.13);box-shadow:inset 0 1px 0 rgba(255,255,255,.08),inset 0 -18px 30px rgba(0,0,0,.08),0 16px 45px rgba(0,0,0,.16);backdrop-filter:blur(20px) saturate(125%);-webkit-backdrop-filter:blur(20px) saturate(125%);transition:border-color .4s ease,box-shadow .4s ease,transform .25s ease}
.fiducia-card::before{content:"";position:absolute;inset:0;pointer-events:none;border-radius:inherit;background:radial-gradient(ellipse at 18% 8%,rgba(255,255,255,.11),transparent 34%);opacity:.55}
.fiducia-card:active{transform:scale(.995);border-color:rgba(212,175,55,.3);box-shadow:inset 0 0 22px rgba(212,175,55,.06),0 14px 40px rgba(0,0,0,.2)}
.fiducia-button{position:relative;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:12px 22px;border-radius:24px;border:1px solid rgba(220,235,250,.15);cursor:pointer;user-select:none;text-decoration:none;text-align:center;font-size:15px;font-weight:500;color:rgba(235,241,250,.84);background:linear-gradient(135deg,rgba(190,215,240,.09),rgba(45,65,92,.08));box-shadow:inset 0 1px 0 rgba(255,255,255,.09),inset 0 -10px 18px rgba(0,0,0,.08),0 8px 24px rgba(0,0,0,.12);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);transition:transform .2s ease,border-color .3s ease,box-shadow .3s ease,color .3s ease}
.fiducia-button::before{content:"";position:absolute;left:50%;top:50%;width:25%;height:25%;transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(circle,rgba(255,246,198,.9),rgba(212,175,55,.32) 45%,transparent 75%);opacity:0;filter:blur(2px);transition:all .35s ease}
.fiducia-button:active{transform:scale(.97)}
.fiducia-button:active::before{width:100%;height:100%;opacity:.7}
.fiducia-button-primary{color:#f3df9c;border-color:rgba(212,175,55,.24)}
.fiducia-button-secondary{color:#a9cef7;border-color:rgba(96,165,250,.2)}
.fiducia-button-ghost{color:rgba(235,241,250,.62);background:rgba(255,255,255,.025)}
.aria-speaks{color:#e9e4d5;font-weight:400;line-height:1.7;letter-spacing:.01em}
.shimmer{background:linear-gradient(90deg,rgba(255,255,255,.025) 25%,rgba(255,255,255,.075) 50%,rgba(255,255,255,.025) 75%);background-size:200% 100%;animation:shimmer 1.8s ease-in-out infinite}
@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
@keyframes skyDrift{0%{transform:translate3d(-2%,-1%,0) scale(1.08)}50%{transform:translate3d(2%,1%,0) scale(1.1)}100%{transform:translate3d(-2%,-1%,0) scale(1.08)}}
@keyframes cloudDrift{0%{transform:translate3d(-5%,2%,0) scale(1.08)}50%{transform:translate3d(5%,-2%,0) scale(1.12)}100%{transform:translate3d(-5%,2%,0) scale(1.08)}}
@keyframes cloudDriftReverse{0%{transform:translate3d(4%,-2%,0) scale(1.12)}50%{transform:translate3d(-4%,2%,0) scale(1.08)}100%{transform:translate3d(4%,-2%,0) scale(1.12)}}
@keyframes ariaBreath{0%,100%{opacity:.72}50%{opacity:.9}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes slideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important}}
@media(max-width:600px){
.ariaNav{top:8px;height:76px}
.ariaNavInner{height:68px;padding:0 3px}
.gasBubble{width:62px;height:62px;flex-basis:62px}
.ariaBubble{width:66px;height:66px;flex-basis:66px}
.liquidBridge{width:30px;height:30px;margin:0 -5px}
.gasIcon{width:22px;height:22px}
.ariaBubble .gasIcon{width:23px;height:23px}
.ariaBrand{top:92px;font-size:44px}
.mainContent{padding:112px 16px 70px}
.fiducia-card{padding:20px;border-radius:24px}
}
@media(min-width:601px){.ariaNavInner{transform:scale(1.05)}}
`}</style>
</>
  }
