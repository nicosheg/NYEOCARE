// components/Layout.js
import Link from'next/link';
import{useRouter}from'next/router';

export default function Layout({children}){
const router=useRouter();
const isActive=path=>router.pathname===path||(path!=='/'&&router.pathname.startsWith(path));
return <>
<svg width="0" height="0" aria-hidden="true" style={{position:'absolute'}}>
<defs>
<filter id="nyoGoo" x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
<feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur"/>
<feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 0 24 -10" result="goo"/>
<feBlend in="goo" in2="SourceGraphic" mode="normal"/>
</filter>
<filter id="nyoGlow" x="-100%" y="-100%" width="300%" height="300%">
<feGaussianBlur stdDeviation="7" result="blur"/>
<feColorMatrix in="blur" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 .8 0"/>
</filter>
</defs>
</svg>

<div className="livingCanvas" aria-hidden="true"><div className="skyGlow"/><div className="cloud cloudA"/><div className="cloud cloudB"/><div className="cloud cloudC"/><div className="cloud cloudD"/><div className="skyVignette"/></div>

<div className="ariaBrand" aria-hidden="true">ARIA</div>

<nav className="ariaNav" aria-label="Primary navigation">
<div className="ariaNavInner">

<div className="gooFusion" aria-hidden="true">
<span className={`gooNode gooNodeLeft ${isActive('/')?'active':''}`}><span className="gooShine"/><span className="gooRim"/></span>
<span className={`gooNode gooNodeCenter ${isActive('/people')?'active':''}`}><span className="gooShine"/><span className="gooRim"/></span>
<span className={`gooNode gooNodeRight ${isActive('/profile')?'active':''}`}><span className="gooShine"/><span className="gooRim"/></span>
</div>

<div className="gooAmbient" aria-hidden="true">
<span className="ambientLeft"/>
<span className="ambientCenter"/>
<span className="ambientRight"/>
</div>

<Link href="/" aria-label="Home" className={`navBubble navBubbleLeft ${isActive('/')?'active':''}`}>
<span className="navIcon">
<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 10.8 12 3.7l8.5 7.1M5.5 9.5v10h13v-10M9.2 19.5v-5.8h5.6v5.8"/></svg>
</span>
</Link>

<Link href="/people" aria-label="People" className={`navBubble navBubbleCenter ${isActive('/people')?'active':''}`}>
<span className="navIcon">
<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.5-3.2 2.4-5 5.5-5s5 1.8 5.5 5"/><path d="M15.4 6.5a2.6 2.6 0 1 1 0 5.2"/><path d="M15.2 14c2.5.3 4.1 1.8 4.8 5"/></svg>
</span>
<span className="ariaHalo"/>
</Link>

<Link href="/profile" aria-label="Profile" className={`navBubble navBubbleRight ${isActive('/profile')?'active':''}`}>
<span className="navIcon navHand">
<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.1 5.2c0-1 .7-1.8 1.7-1.8s1.7.8 1.7 1.8v5.1l.7-1.1c.5-.8 1.6-1.1 2.4-.6.8.5 1 1.5.6 2.3l-1.1 2c-.5.9-.7 1.4-.7 2.1 0 2.4-1.9 4.3-4.3 4.3h-1.2c-1.4 0-2.7-.5-3.7-1.5l-3.6-3.6c-.7-.7-.7-1.8 0-2.5.7-.7 1.8-.7 2.5 0l2.1 2.1V7.5c0-1 .7-1.8 1.7-1.8s1.7.8 1.7 1.8v2.1-4.4Z"/><path d="M14.5 10.4V7.1c0-1 .7-1.8 1.7-1.8s1.7.8 1.7 1.8v4.1"/><path d="M8.8 13.8V6.8c0-1 .7-1.8 1.7-1.8s1.7.8 1.7 1.8v4.9"/></svg>
</span>
</Link>

</div>
</nav>

<main className="mainContent">{children}</main>

<style jsx global>{`
*{box-sizing:border-box}
html,body,#__next{min-height:100%;margin:0}
body{background:#050a14;color:#edf3fb}

.livingCanvas{position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none;background:radial-gradient(ellipse at 50% 8%,rgba(23,46,83,.42),transparent 45%),radial-gradient(ellipse at 15% 65%,rgba(12,31,61,.5),transparent 52%),radial-gradient(ellipse at 85% 35%,rgba(16,35,69,.38),transparent 50%),#050a14}
.skyGlow{position:absolute;inset:-20%;background:radial-gradient(ellipse at 50% 35%,rgba(80,111,157,.08),transparent 48%),radial-gradient(ellipse at 30% 70%,rgba(70,95,145,.045),transparent 45%);animation:skyDrift 42s ease-in-out infinite}
.cloud{position:absolute;width:75vw;height:24vw;min-height:130px;max-height:360px;border-radius:50%;filter:blur(38px);opacity:.105;background:radial-gradient(ellipse at 20% 50%,rgba(154,177,211,.72),transparent 42%),radial-gradient(ellipse at 48% 35%,rgba(106,139,181,.58),transparent 46%),radial-gradient(ellipse at 75% 58%,rgba(143,166,201,.5),transparent 43%)}
.cloudA{top:12%;left:-18%;animation:cloudDrift 48s ease-in-out infinite}
.cloudB{top:38%;right:-25%;opacity:.075;animation:cloudDriftReverse 58s ease-in-out infinite}
.cloudC{bottom:8%;left:-20%;opacity:.08;animation:cloudDrift 65s ease-in-out infinite}
.cloudD{top:62%;right:-25%;opacity:.055;animation:cloudDriftReverse 72s ease-in-out infinite}
.skyVignette{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(2,5,12,.08),rgba(2,5,12,.22)),radial-gradient(ellipse at center,transparent 38%,rgba(2,5,12,.42) 100%)}

.ariaBrand{position:fixed;top:105px;left:50%;transform:translateX(-50%);z-index:2;pointer-events:none;user-select:none;font-size:clamp(42px,11vw,92px);line-height:1;font-weight:700;letter-spacing:.16em;padding-left:.16em;color:rgba(229,236,248,.13);-webkit-text-stroke:1px rgba(255,255,255,.08);text-shadow:0 0 18px rgba(180,205,235,.06),0 0 48px rgba(91,130,180,.045);opacity:.85;animation:ariaBreath 18s ease-in-out infinite}

.ariaNav{position:fixed;top:14px;left:0;right:0;z-index:999;width:100%;height:92px;display:flex;justify-content:center;align-items:center;pointer-events:none;animation:ariaFlight 11s ease-in-out infinite}
.ariaNavInner{position:relative;width:226px;height:88px;display:flex;align-items:center;justify-content:center;pointer-events:auto}

.gooFusion{position:absolute;z-index:1;left:50%;top:50%;width:226px;height:88px;transform:translate(-50%,-50%);pointer-events:none;filter:url(#nyoGoo);overflow:visible}
.gooNode{position:absolute;display:block;border-radius:50%;box-shadow:inset 8px 9px 19px rgba(255,255,255,.2),inset -10px -12px 24px rgba(0,0,0,.34),inset 0 -3px 10px rgba(11,25,43,.2),0 9px 28px rgba(0,0,0,.25);will-change:transform}
.gooNodeLeft{left:4px;top:7px;width:78px;height:78px;background:radial-gradient(circle at 31% 23%,rgba(255,255,255,.48) 0,rgba(221,239,255,.3) 13%,rgba(158,193,226,.2) 29%,rgba(69,105,145,.22) 57%,rgba(17,34,56,.58) 82%,rgba(3,9,18,.72) 100%);animation:gooFloatLeft 7.8s ease-in-out infinite}
.gooNodeCenter{left:69px;top:3px;width:86px;height:86px;background:radial-gradient(circle at 36% 24%,rgba(255,255,255,.5) 0,rgba(240,244,250,.28) 13%,rgba(185,207,230,.22) 30%,rgba(76,111,148,.22) 57%,rgba(18,34,54,.56) 82%,rgba(3,9,18,.72) 100%);animation:gooFloatCenter 8.6s ease-in-out infinite}
.gooNodeRight{right:4px;top:7px;width:78px;height:78px;background:radial-gradient(circle at 31% 23%,rgba(255,255,255,.48) 0,rgba(221,239,255,.3) 13%,rgba(158,193,226,.2) 29%,rgba(69,105,145,.22) 57%,rgba(17,34,56,.58) 82%,rgba(3,9,18,.72) 100%);animation:gooFloatRight 8.2s ease-in-out infinite}

.gooNode::before{content:"";position:absolute;inset:3px;border-radius:50%;background:radial-gradient(circle at 72% 78%,rgba(1,7,15,.36),transparent 48%),radial-gradient(circle at 38% 30%,rgba(255,255,255,.12),transparent 34%);pointer-events:none}
.gooNode::after{content:"";position:absolute;inset:1px;border-radius:50%;border:1px solid rgba(239,248,255,.28);box-shadow:inset 0 1px 2px rgba(255,255,255,.25),0 0 12px rgba(143,188,231,.08);pointer-events:none}
.gooNode.active{box-shadow:inset 8px 9px 19px rgba(255,255,255,.24),inset -10px -12px 24px rgba(0,0,0,.28),inset 0 0 25px rgba(212,175,55,.16),0 0 16px rgba(212,175,55,.3),0 10px 30px rgba(0,0,0,.26)}
.gooNode.active::after{border-color:rgba(247,225,150,.55);box-shadow:inset 0 1px 2px rgba(255,255,255,.3),0 0 17px rgba(212,175,55,.18)}

.gooShine{position:absolute;z-index:2;left:19%;top:13%;width:28%;height:13%;border-radius:50%;background:rgba(255,255,255,.34);filter:blur(3px);transform:rotate(-23deg);pointer-events:none}
.gooNodeCenter .gooShine{left:21%;top:12%;width:27%;height:12%}
.gooRim{position:absolute;z-index:2;inset:7%;border-radius:50%;border:1px solid rgba(214,235,255,.09);box-shadow:inset 2px 2px 6px rgba(255,255,255,.08);pointer-events:none}

.gooAmbient{position:absolute;z-index:0;left:50%;top:50%;width:226px;height:88px;transform:translate(-50%,-50%);pointer-events:none}
.gooAmbient span{position:absolute;border-radius:50%;filter:blur(15px);background:rgba(83,135,190,.09);animation:ambientPulse 6s ease-in-out infinite}
.ambientLeft{left:7px;top:13px;width:72px;height:72px}
.ambientCenter{left:75px;top:8px;width:78px;height:78px;animation-delay:-2s!important}
.ambientRight{right:7px;top:13px;width:72px;height:72px;animation-delay:-4s!important}

.navBubble{position:absolute;z-index:5;top:50%;display:flex;align-items:center;justify-content:center;width:78px;height:78px;border:0;border-radius:50%;background:transparent;box-shadow:none;text-decoration:none;cursor:pointer;overflow:visible;transform:translateY(-50%);outline:none;-webkit-tap-highlight-color:transparent}
.navBubbleLeft{left:4px;animation:linkFloatLeft 7.8s ease-in-out infinite}
.navBubbleCenter{left:112px;width:86px;height:86px;transform:translate(-50%,-50%);animation:linkFloatCenter 8.6s ease-in-out infinite}
.navBubbleRight{right:4px;animation:linkFloatRight 8.2s ease-in-out infinite}
.navBubble:focus-visible{outline:2px solid rgba(245,220,132,.8);outline-offset:5px}
.navBubble:active{transform:translateY(-50%) scale(.94)}
.navBubbleCenter:active{transform:translate(-50%,-50%) scale(.94)}

.navIcon{position:relative;z-index:8;width:25px;height:25px;display:flex;align-items:center;justify-content:center;color:rgba(232,241,251,.86);transition:color .35s ease,filter .35s ease,transform .45s cubic-bezier(.2,.8,.2,1)}
.navBubbleCenter .navIcon{width:29px;height:29px}
.navHand{width:28px;height:28px}
.navIcon svg{width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:1.55;stroke-linecap:round;stroke-linejoin:round}
.navHand svg{fill:currentColor;stroke:none}
.navBubble.active .navIcon{color:#fff3bd;filter:drop-shadow(0 0 8px rgba(255,247,214,.95)) drop-shadow(0 0 20px rgba(212,175,55,.72)) drop-shadow(0 0 34px rgba(212,175,55,.3));transform:scale(1.08)}

.ariaHalo{position:absolute;z-index:1;inset:-10px;border-radius:50%;border:1px solid rgba(212,175,55,.035);box-shadow:0 0 24px rgba(212,175,55,.04);pointer-events:none;transition:all .5s ease}
.navBubbleCenter.active .ariaHalo{inset:-14px;border-color:rgba(212,175,55,.2);box-shadow:0 0 28px rgba(212,175,55,.16),0 0 54px rgba(212,175,55,.08)}

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

@keyframes ariaFlight{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(0,-5px,0)}}
@keyframes gooFloatLeft{0%,100%{transform:translate3d(0,0,0) rotate(-1deg)}50%{transform:translate3d(1px,-2px,0) rotate(1deg)}}
@keyframes gooFloatCenter{0%,100%{transform:translate3d(0,0,0) scale(1)}50%{transform:translate3d(0,-3px,0) scale(1.018)}}
@keyframes gooFloatRight{0%,100%{transform:translate3d(0,0,0) rotate(1deg)}50%{transform:translate3d(-1px,-2px,0) rotate(-1deg)}}
@keyframes linkFloatLeft{0%,100%{transform:translateY(-50%) rotate(-1deg)}50%{transform:translate3d(1px,-2px,0) translateY(-50%) rotate(1deg)}}
@keyframes linkFloatCenter{0%,100%{transform:translate(-50%,-50%) scale(1)}50%{transform:translate(-50%,calc(-50% - 3px)) scale(1.018)}}
@keyframes linkFloatRight{0%,100%{transform:translateY(-50%) rotate(1deg)}50%{transform:translate3d(-1px,-2px,0) translateY(-50%) rotate(-1deg)}}
@keyframes ambientPulse{0%,100%{opacity:.45;transform:scale(.94)}50%{opacity:.8;transform:scale(1.05)}}
@keyframes rotateRays{to{transform:rotate(360deg)}}
@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
@keyframes skyDrift{0%{transform:translate3d(-2%,-1%,0) scale(1.08)}50%{transform:translate3d(2%,1%,0) scale(1.1)}100%{transform:translate3d(-2%,-1%,0) scale(1.08)}}
@keyframes cloudDrift{0%{transform:translate3d(-5%,2%,0) scale(1.08)}50%{transform:translate3d(5%,-2%,0) scale(1.12)}100%{transform:translate3d(-5%,2%,0) scale(1.08)}}
@keyframes cloudDriftReverse{0%{transform:translate3d(4%,-2%,0) scale(1.12)}50%{transform:translate3d(-4%,2%,0) scale(1.08)}100%{transform:translate3d(4%,-2%,0) scale(1.12)}}
@keyframes ariaBreath{0%,100%{opacity:.72}50%{opacity:.9}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes slideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}

@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important}}

@media(max-width:600px){
.ariaNav{top:8px;height:78px}
.ariaNavInner{width:190px;height:72px}
.gooFusion{width:190px;height:72px}
.gooNodeLeft{left:3px;top:5px;width:64px;height:64px}
.gooNodeCenter{left:58px;top:2px;width:70px;height:70px}
.gooNodeRight{right:3px;top:5px;width:64px;height:64px}
.gooAmbient{width:190px;height:72px}
.ambientLeft{left:5px;top:9px;width:60px;height:60px}
.ambientCenter{left:63px;top:5px;width:64px;height:64px}
.ambientRight{right:5px;top:9px;width:60px;height:60px}
.navBubble{width:64px;height:64px}
.navBubbleLeft{left:3px}
.navBubbleCenter{left:95px;width:70px;height:70px}
.navBubbleRight{right:3px}
.navIcon{width:22px;height:22px}
.navBubbleCenter .navIcon{width:24px;height:24px}
.navHand{width:25px;height:25px}
.ariaBrand{top:92px;font-size:44px}
.mainContent{padding:112px 16px 70px}
.fiducia-card{padding:20px;border-radius:24px}
}

@media(min-width:601px){.ariaNavInner{transform:scale(1.05)}}
`}</style>
</>
  }
