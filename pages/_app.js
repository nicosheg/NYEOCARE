// pages/_app.js
import{OnboardingProvider}from'../components/OnboardingProvider';
import AriaAutoSync from'../components/AriaAutoSync';
import NyeoEnvironment from'../components/NyeoEnvironment';

export default function App({Component,pageProps}){
return(
<OnboardingProvider>
<NyeoEnvironment/>
<AriaAutoSync/>
<style jsx global>{`
:root{
--ny-bg:#070D1D;--ny-surface:#0B1326;--ny-surface-2:#101A31;--ny-text:#F5F7FA;--ny-text-secondary:rgba(245,247,250,.68);--ny-text-muted:rgba(245,247,250,.42);--ny-text-whisper:rgba(245,247,250,.25);--ny-gold:#D6B86A;--ny-gold-soft:#E8D49A;--ny-aria:#8FAFD6;--ny-success:#7FBF9A;--ny-warning:#D6B86A;--ny-danger:#D77B7B;--ny-border:rgba(255,255,255,.08);--ny-border-subtle:rgba(255,255,255,.055);--ny-border-strong:rgba(255,255,255,.14);--ny-gold-border:rgba(214,184,106,.30);--ny-aria-border:rgba(143,175,214,.25);--ny-radius-sm:8px;--ny-radius-md:12px;--ny-radius-button:16px;--ny-radius-card:20px;--ny-radius-major:24px;--ny-radius-surface:28px;--ny-radius-hero:32px;--ny-shadow:0 8px 30px rgba(0,0,0,.16);--ny-shadow-lg:0 18px 60px rgba(0,0,0,.22);--ny-shadow-xl:0 30px 100px rgba(0,0,0,.45);--ny-atmosphere:1;--ny-sky-light:0;--ny-sky-warm:0;--ny-sky-cool:0;--ny-cloud-opacity:.10;--ny-rain-opacity:0;--ny-storm-opacity:0;
}
*{box-sizing:border-box}html,body,#__next{margin:0;min-height:100%;width:100%}html{background:var(--ny-bg)}body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Segoe UI",Roboto,sans-serif;color:var(--ny-text);background:var(--ny-bg);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;transition:background 2s ease,color .5s ease}button,input,textarea,select{font:inherit}button{color:inherit}a{-webkit-tap-highlight-color:transparent}::selection{background:rgba(214,184,106,.25);color:#fff}
html[data-nyeo-time="dawn"]{--ny-sky-light:.55;--ny-sky-warm:.35;--ny-sky-cool:.12}html[data-nyeo-time="morning"]{--ny-sky-light:.72;--ny-sky-warm:.18;--ny-sky-cool:.22}html[data-nyeo-time="afternoon"]{--ny-sky-light:.58;--ny-sky-warm:.08;--ny-sky-cool:.28}html[data-nyeo-time="evening"]{--ny-sky-light:.28;--ny-sky-warm:.42;--ny-sky-cool:.18}html[data-nyeo-time="night"]{--ny-sky-light:.05;--ny-sky-warm:.02;--ny-sky-cool:.38}
html[data-nyeo-weather="clear"]{--ny-cloud-opacity:.035}html[data-nyeo-weather="cloudy"]{--ny-cloud-opacity:.16}html[data-nyeo-weather="rain"]{--ny-cloud-opacity:.20;--ny-rain-opacity:.08}html[data-nyeo-weather="storm"]{--ny-cloud-opacity:.25;--ny-rain-opacity:.12;--ny-storm-opacity:.16}html[data-nyeo-weather="unknown"]{--ny-cloud-opacity:.10}
.mainContent{min-height:100dvh;padding-bottom:env(safe-area-inset-bottom)}
.mainContent>main[style*="100dvh"]{height:auto!important;min-height:calc(100dvh - 80px)!important;overflow:visible!important}
.mainContent>main[style*="100dvh"] .coming{position:relative!important;left:auto!important;right:auto!important;bottom:auto!important;margin:38px auto 0!important}
@media(max-width:380px){.mainContent>main[style*="100dvh"]{padding-left:15px!important;padding-right:15px!important}.ariaNavInner{transform:scale(.92)}}
@media(max-height:700px){.mainContent>main[style*="100dvh"]{padding-bottom:112px!important}.mainContent>main[style*="100dvh"] .coming{margin-top:28px!important}}
.ariaBrand{font-size:0!important;letter-spacing:.12em!important;white-space:nowrap}.ariaBrand::after{content:"NYEOCARE";font-size:clamp(34px,9vw,78px);font-weight:700;letter-spacing:.18em;padding-left:.18em}
@keyframes nySkyLife{0%,100%{opacity:.72;transform:scale(1)}50%{opacity:1;transform:scale(1.035)}}@keyframes nyAtmosphere{0%,100%{transform:translate3d(-1%,0,0)}50%{transform:translate3d(1%,1%,0)}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important;transition:none!important}}
`}</style>
<Component {...pageProps}/>
</OnboardingProvider>
);
}
