// components/Layout.js
import Link from 'next/link';
import { useRouter } from 'next/router';

export default function Layout({ children }) {
  const router = useRouter();
  const isActive = path => router.pathname === path || (path !== '/' && router.pathname.startsWith(path));
  return <>
    <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>
      <defs>
        {/* stronger blur + sharper alpha cutoff = thicker, more pronounced liquid pinch */}
        <filter id="nyoGoo" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="13" result="blur" />
          <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 26 -11" result="goo" />
          <feComposite in="SourceGraphic" in2="goo" operator="atop" />
        </filter>
      </defs>
    </svg>

    <div className="livingCanvas" aria-hidden="true"><div className="skyGlow" /><div className="cloud cloudA" /><div className="cloud cloudB" /><div className="cloud cloudC" /><div className="cloud cloudD" /><div className="skyVignette" /></div>

    <div className="ariaBrand" aria-hidden="true">ARIA</div>

    <nav className="ariaNav" aria-label="Primary navigation">
      <div className="ariaNavInner">

        {/* GLASS LAYER — the real visible bubbles, goo-fused into one liquid shape */}
        <div className="gooFusion" aria-hidden="true">
          <span className="gooNode gooNodeLeft" />
          <span className="gooNode gooNodeCenter" />
          <span className="gooNode gooNodeRight" />
        </div>

        {/* ICON LAYER — transparent, sits exactly on top of the glass layer via matching flex geometry */}
        <div className="navIconRow">
          <Link href="/" aria-label="Home" className={`navBubble navBubbleLeft ${isActive('/') ? 'active' : ''}`}>
            <span className="navRay" /><span className="navCore" />
            <span className="navIcon">
              <svg viewBox="0 0 24 24"><path d="M3.5 10.8 12 3.7l8.5 7.1M5.5 9.5v10h13v-10M9.2 19.5v-5.8h5.6v5.8" /></svg>
            </span>
          </Link>

          <Link href="/people" aria-label="People" className={`navBubble navBubbleCenter ${isActive('/people') ? 'active' : ''}`}>
            <span className="navRay" /><span className="navCore" />
            <span className="navIcon">
              {/* two overlapping figures — reads clearly as "people", distinct from Profile's single figure */}
              <svg viewBox="0 0 24 24"><circle cx="8.5" cy="8" r="2.6" /><path d="M3.5 19c.5-3.2 2.3-4.8 5-4.8s4.5 1.6 5 4.8" /><circle cx="16.2" cy="9" r="2.1" /><path d="M14.3 14.6c.5-.3 1.1-.4 1.9-.4 2.4 0 3.9 1.4 4.3 4" /></svg>
            </span>
            <span className="ariaHalo" />
          </Link>

          <Link href="/profile" aria-label="Profile" className={`navBubble navBubbleRight ${isActive('/profile') ? 'active' : ''}`}>
            <span className="navRay" /><span className="navCore" />
            <span className="navIcon">
              {/* pointing hand — "you", the pointing-finger gesture translated to line art */}
              <svg viewBox="0 0 24 24"><path d="M9 12.5V5.2a1.6 1.6 0 0 1 3.2 0v6.3M12.2 11.3V4.4a1.6 1.6 0 0 1 3.2 0v7M15.4 11.6V6.6a1.6 1.6 0 0 1 3.2 0v8.4c0 4-2.6 6.5-6.4 6.5-2.2 0-3.6-.7-4.9-2.3l-3.4-4.2a1.5 1.5 0 0 1 2.3-1.9l1.8 1.9" /></svg>
            </span>
          </Link>
        </div>

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

.ariaNav{position:fixed;top:14px;left:0;right:0;z-index:999;width:100%;height:88px;display:flex;justify-content:center;align-items:center;pointer-events:none}
.ariaNavInner{position:relative;width:210px;height:86px;display:flex;align-items:center;justify-content:center;pointer-events:auto}

/* GLASS LAYER: real spherical bubbles, fused via goo filter. Overlap increased (-30px) for a true pinched liquid waist. */
.gooFusion{position:absolute;z-index:1;inset:0;display:flex;align-items:center;justify-content:center;filter:url(#nyoGoo);pointer-events:none}
.gooNode{position:relative;flex:0 0 auto;border-radius:50%;background:radial-gradient(circle at 30% 22%,rgba(255,255,255,.55) 0%,rgba(255,255,255,.22) 8%,transparent 16%),radial-gradient(circle at 38% 30%,rgba(210,228,248,.28),rgba(120,155,196,.16) 40%,rgba(40,62,92,.32) 72%,rgba(4,10,20,.55) 100%);box-shadow:inset 9px 10px 20px rgba(255,255,255,.16),inset -10px -14px 26px rgba(0,0,0,.4),inset 0 0 3px rgba(255,255,255,.5),0 10px 32px rgba(0,0,0,.3)}
.gooNodeLeft,.gooNodeRight{width:76px;height:76px;animation:bobA 7.5s ease-in-out infinite}
.gooNodeRight{animation-name:bobC;animation-duration:9.5s}
.gooNodeCenter{width:82px;height:82px;margin:0 -30px;background:radial-gradient(circle at 32% 24%,rgba(255,250,225,.6) 0%,rgba(255,244,190,.25) 9%,transparent 17%),radial-gradient(circle at 45% 40%,rgba(255,246,198,.2),rgba(150,125,60,.14) 42%,rgba(30,25,12,.32) 74%,rgba(4,8,16,.5) 100%);box-shadow:inset 9px 10px 20px rgba(255,255,255,.18),inset -10px -14px 26px rgba(0,0,0,.36),inset 0 0 3px rgba(255,247,214,.55),0 10px 32px rgba(0,0,0,.3);animation:bobB 8.5s ease-in-out infinite}

/* ICON LAYER: transparent, mirrors the flex geometry above exactly so icons land centered on each fused shape */
.navIconRow{position:absolute;z-index:3;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
.navBubble{position:relative;flex:0 0 auto;display:flex;align-items:center;justify-content:center;border-radius:50%;text-decoration:none;cursor:pointer;pointer-events:auto;width:76px;height:76px;background:transparent;transition:transform .35s cubic-bezier(.2,.8,.2,1)}
.navBubbleLeft{animation:bobA 7.5s ease-in-out infinite}
.navBubbleCenter{width:82px;height:82px;margin:0 -30px;animation:bobB 8.5s ease-in-out infinite}
.navBubbleRight{animation:bobC 9.5s ease-in-out infinite}
.navBubble:active{transform:scale(.93)}

.navCore{position:absolute;z-index:1;left:50%;top:50%;width:43%;height:43%;transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(circle,rgba(255,249,211,.98),rgba(245,214,112,.86) 18%,rgba(212,175,55,.4) 44%,rgba(212,175,55,.1) 68%,transparent 100%);filter:blur(2.5px);opacity:.025;transition:opacity .45s ease,transform .45s ease}
.navBubble.active .navCore{opacity:.98;transform:translate(-50%,-50%) scale(1.25)}

.navRay{position:absolute;z-index:1;inset:-30%;border-radius:50%;pointer-events:none;opacity:0;background:conic-gradient(from 0deg,transparent 0deg,rgba(212,175,55,.2) 12deg,transparent 25deg,transparent 75deg,rgba(255,242,177,.13) 91deg,transparent 110deg,transparent 180deg,rgba(212,175,55,.17) 198deg,transparent 220deg,transparent 285deg,rgba(255,244,190,.12) 300deg,transparent 322deg,transparent 360deg);filter:blur(1px);transition:opacity .4s ease}
.navBubble.active .navRay{opacity:1;animation:rotateRays 8s linear infinite}

.navIcon{position:relative;z-index:5;width:25px;height:25px;display:flex;align-items:center;justify-content:center;color:rgba(224,235,248,.78);transition:color .35s ease,filter .35s ease,transform .35s ease}
.navBubbleCenter .navIcon{width:27px;height:27px}
.navIcon svg{width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:1.55;stroke-linecap:round;stroke-linejoin:round}
.navBubble.active .navIcon{color:#fff3bd;filter:drop-shadow(0 0 8px rgba(255,247,214,.95)) drop-shadow(0 0 20px rgba(212,175,55,.72)) drop-shadow(0 0 34px rgba(212,175,55,.3));transform:scale(1.08)}

.ariaHalo{position:absolute;z-index:0;inset:-12px;border-radius:50%;border:1px solid rgba(212,175,55,.04);box-shadow:0 0 26px rgba(212,175,55,.05);pointer-events:none;transition:all .5s ease}
.navBubbleCenter.active .ariaHalo{inset:-15px;border-color:rgba(212,175,55,.2);box-shadow:0 0 28px rgba(212,175,55,.16),0 0 54px rgba(212,175,55,.08)}

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

/* independent, unsynchronized bob per bubble — different durations so they never move in unison */
@keyframes bobA{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes bobB{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
@keyframes bobC{0%,100%{transform:translateY(0)}50%{transform:translateY(-3.5px)}}
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
.ariaNavInner{width:178px;height:76px}
.gooNodeLeft,.gooNodeRight{width:64px;height:64px}
.gooNodeCenter{width:70px;height:70px;margin:0 -26px}
.navBubble{width:64px;height:64px}
.navBubbleCenter{width:70px;height:70px;margin:0 -26px}
.navIcon{width:22px;height:22px}
.navBubbleCenter .navIcon{width:23px;height:23px}
.ariaBrand{top:92px;font-size:44px}
.mainContent{padding:112px 16px 70px}
.fiducia-card{padding:20px;border-radius:24px}
}
@media(min-width:601px){.ariaNavInner{transform:scale(1.05)}}
`}</style>
  </>
    }
    
