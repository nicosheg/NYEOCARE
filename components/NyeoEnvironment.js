// components/NyeoEnvironment.js
import{useEffect}from'react';

const weatherState=c=>{if(c==null)return'unknown';c=Number(c);if([95,96,99].includes(c))return'storm';if((c>=51&&c<=67)||(c>=80&&c<=82))return'rain';if((c>=71&&c<=77)||c===85||c===86)return'cloudy';if(c===45||c===48)return'cloudy';return'clear'};
const timeState=()=>{const h=new Date().getHours();return h>=5&&h<8?'dawn':h>=8&&h<12?'morning':h>=12&&h<17?'afternoon':h>=17&&h<21?'evening':'night'};
const timeIntensity={dawn:.72,morning:.94,afternoon:1,evening:.78,night:.48};
const weatherIntensity={clear:1,cloudy:.82,rain:.64,storm:.48,unknown:.9};

export default function NyeoEnvironment(){
useEffect(()=>{
let alive=true,weatherWatch=null;
const apply=(time,weather='unknown',status='unknown',temperature=null)=>{
if(!alive)return;
const root=document.documentElement,intensity=(timeIntensity[time]||.8)*(weatherIntensity[weather]||.8);
root.dataset.nyeoTime=time;root.dataset.nyeoWeather=weather;root.dataset.nyeoWeatherStatus=status;
if(temperature!=null)root.dataset.nyeoTemperature=String(temperature);else delete root.dataset.nyeoTemperature;
root.style.setProperty('--ny-environment-time',`'${time}'`);root.style.setProperty('--ny-weather',`'${weather}'`);root.style.setProperty('--ny-environment-intensity',String(intensity));root.style.setProperty('--ny-environment-warmth',time==='dawn'||time==='evening'?'1':'0');root.style.setProperty('--ny-environment-dim',time==='night'?'1':'0');
};
const updateTime=()=>apply(timeState(),document.documentElement.dataset.nyeoWeather||'unknown',document.documentElement.dataset.nyeoWeatherStatus||'unknown',document.documentElement.dataset.nyeoTemperature||null);
const getWeather=()=>{
if(!navigator.geolocation){apply(timeState(),'unknown','unavailable');return}
apply(timeState(),document.documentElement.dataset.nyeoWeather||'unknown','requesting',document.documentElement.dataset.nyeoTemperature||null);
navigator.geolocation.getCurrentPosition(async pos=>{
if(!alive)return;
try{
const{latitude,longitude}=pos.coords,r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&timezone=auto`);
if(!r.ok){apply(timeState(),'unknown','unavailable');return}
const d=await r.json();if(!alive)return;apply(timeState(),weatherState(d.current?.weather_code),'ready',d.current?.temperature_2m);
}catch{if(alive)apply(timeState(),'unknown','unavailable')}
},()=>{if(alive)apply(timeState(),'unknown','unavailable')},{enableHighAccuracy:false,maximumAge:3600000,timeout:7000});
};
const update=()=>{updateTime();getWeather()};
update();
const timeTimer=setInterval(updateTime,60000),weatherTimer=setInterval(getWeather,3600000);
if(navigator.permissions?.query){navigator.permissions.query({name:'geolocation'}).then(permission=>{if(!alive)return;const handle=()=>{if(permission.state==='granted')getWeather();else if(permission.state==='denied')apply(timeState(),'unknown','unavailable')};permission.addEventListener?.('change',handle);weatherWatch={permission,handle};if(permission.state==='granted')getWeather();else if(permission.state==='denied')apply(timeState(),'unknown','unavailable')}).catch(()=>{})}
return()=>{alive=false;clearInterval(timeTimer);clearInterval(weatherTimer);if(weatherWatch?.permission&&weatherWatch.handle)weatherWatch.permission.removeEventListener?.('change',weatherWatch.handle)};
},[]);
return <style jsx global>{`
html[data-nyeo-time="dawn"] .livingCanvas{background:radial-gradient(ellipse at 50% 8%,rgba(126,125,154,.48),transparent 45%),radial-gradient(ellipse at 18% 65%,rgba(54,76,108,.52),transparent 52%),#11192a}
html[data-nyeo-time="morning"] .livingCanvas{background:radial-gradient(ellipse at 50% 8%,rgba(86,126,166,.62),transparent 45%),radial-gradient(ellipse at 15% 65%,rgba(43,79,116,.58),transparent 52%),#142238}
html[data-nyeo-time="afternoon"] .livingCanvas{background:radial-gradient(ellipse at 50% 6%,rgba(116,157,193,.78),transparent 48%),radial-gradient(ellipse at 16% 68%,rgba(67,108,145,.7),transparent 54%),radial-gradient(ellipse at 88% 35%,rgba(104,139,168,.52),transparent 52%),#243c56}
html[data-nyeo-time="evening"] .livingCanvas{background:radial-gradient(ellipse at 50% 10%,rgba(112,92,103,.55),transparent 46%),radial-gradient(ellipse at 15% 68%,rgba(48,61,91,.62),transparent 54%),#182337}
html[data-nyeo-time="night"] .livingCanvas{background:radial-gradient(ellipse at 50% 8%,rgba(23,39,76,.4),transparent 45%),radial-gradient(ellipse at 15% 65%,rgba(9,25,55,.52),transparent 52%),#050a14}
html[data-nyeo-time="afternoon"] .skyGlow{background:radial-gradient(ellipse at 50% 30%,rgba(220,236,248,.14),transparent 48%),radial-gradient(ellipse at 25% 72%,rgba(190,216,235,.07),transparent 46%)}
html[data-nyeo-time="morning"] .skyGlow{background:radial-gradient(ellipse at 50% 30%,rgba(214,232,246,.11),transparent 48%),radial-gradient(ellipse at 25% 72%,rgba(180,207,230,.06),transparent 46%)}
html[data-nyeo-time="afternoon"] .skyVignette{background:linear-gradient(to bottom,rgba(7,15,27,.02),rgba(7,15,27,.1)),radial-gradient(ellipse at center,transparent 35%,rgba(7,15,27,.2) 100%)}
html[data-nyeo-time="morning"] .skyVignette{background:linear-gradient(to bottom,rgba(7,15,27,.03),rgba(7,15,27,.14)),radial-gradient(ellipse at center,transparent 35%,rgba(7,15,27,.25) 100%)}
html[data-nyeo-weather="cloudy"] .cloud{opacity:.14}html[data-nyeo-weather="rain"] .cloud{opacity:.19}html[data-nyeo-weather="storm"] .cloud{opacity:.25}html[data-nyeo-weather="clear"] .cloud{opacity:.075}
html[data-nyeo-weather="rain"] .skyGlow{animation-duration:58s}html[data-nyeo-weather="storm"] .skyGlow{animation-duration:72s}
html[data-nyeo-weather="storm"] .skyVignette{background:linear-gradient(to bottom,rgba(2,5,12,.2),rgba(2,5,12,.38)),radial-gradient(ellipse at center,transparent 32%,rgba(2,5,12,.55) 100%)}
html[data-nyeo-time="night"] .skyVignette{background:linear-gradient(to bottom,rgba(2,5,12,.18),rgba(2,5,12,.34)),radial-gradient(ellipse at center,transparent 38%,rgba(2,5,12,.5) 100%)}
html[data-nyeo-time="dawn"] .ariaBrand,html[data-nyeo-time="evening"] .ariaBrand{text-shadow:0 0 22px rgba(214,184,106,.08),0 0 54px rgba(143,175,214,.05)}html[data-nyeo-time="night"] .ariaBrand{opacity:.7}
.mainContent main>section:nth-of-type(2) button span:first-child,.mainContent main>section:nth-of-type(2) button>b{display:none!important}
.mainContent main>section:nth-of-type(2) button{height:56px!important;border-radius:18px!important;border:1px solid rgba(255,255,255,.13)!important;background:linear-gradient(145deg,rgba(255,255,255,.11),rgba(255,255,255,.045))!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.1),0 10px 28px rgba(2,8,18,.16)!important;color:rgba(248,250,253,.9)!important;font-size:12px!important;letter-spacing:.01em!important;backdrop-filter:blur(18px)!important;transition:transform .25s ease,border-color .25s ease,background .25s ease,box-shadow .25s ease!important}
.mainContent main>section:nth-of-type(2) button:active{transform:scale(.97)!important}
.mainContent main>section:nth-of-type(2) button:hover{background:linear-gradient(145deg,rgba(255,255,255,.15),rgba(255,255,255,.06))!important;border-color:rgba(255,255,255,.2)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.12),0 13px 32px rgba(2,8,18,.2)!important}
.mainContent main>section:nth-of-type(2) button:nth-child(2){color:rgba(238,247,242,.92)!important}
.mainContent main>section:nth-of-type(2) button:nth-child(3){color:rgba(247,235,203,.94)!important}
@media(prefers-reduced-motion:reduce){html .livingCanvas *,html .ariaBrand{animation:none!important}}
`}</style>;
}
