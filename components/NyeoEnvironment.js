// components/NyeoEnvironment.js
import{useEffect}from'react';

const weatherState=c=>{if(c==null)return'unknown';c=Number(c);if([95,96,99].includes(c))return'storm';if((c>=51&&c<=67)||(c>=80&&c<=82))return'rain';if((c>=71&&c<=77)||c===85||c===86)return'cloudy';if(c===45||c===48)return'cloudy';return'clear'};
const timeState=()=>{const h=new Date().getHours();return h>=5&&h<8?'dawn':h>=8&&h<12?'morning':h>=12&&h<17?'afternoon':h>=17&&h<21?'evening':'night'};
const timeIntensity={dawn:.82,morning:1,afternoon:1,evening:.82,night:.48};
const weatherIntensity={clear:1,cloudy:.86,rain:.68,storm:.5,unknown:.92};

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
if(weatherInFlight||Date.now()-lastWeatherAttempt<15000)return;
try{const saved=sessionStorage.getItem(WEATHER_KEY);if(saved){const d=JSON.parse(saved);if(d&&Date.now()-Number(d.at)<3600000){apply(timeState(),d.weather||'unknown','ready',d.temperature);return}}}catch{}
if(!navigator.geolocation){apply(timeState(),'unknown','unavailable');return}
weatherInFlight=true;lastWeatherAttempt=Date.now();
apply(timeState(),document.documentElement.dataset.nyeoWeather||'unknown','requesting',document.documentElement.dataset.nyeoTemperature||null);
const finish=()=>{weatherInFlight=false};
navigator.geolocation.getCurrentPosition(async pos=>{
if(!alive)return;
try{
const{latitude,longitude}=pos.coords,r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&timezone=auto`);
if(!r.ok){apply(timeState(),'unknown','unavailable');finish();return}
const d=await r.json();if(!alive){finish();return}const weather=weatherState(d.current?.weather_code),temperature=d.current?.temperature_2m;apply(timeState(),weather,'ready',temperature);try{sessionStorage.setItem(WEATHER_KEY,JSON.stringify({at:Date.now(),weather,temperature}))}catch{}finish();
}catch{if(alive)apply(timeState(),'unknown','unavailable');finish()}
},()=>{if(alive)apply(timeState(),'unknown','unavailable');finish()},{enableHighAccuracy:false,maximumAge:3600000,timeout:7000});
};
const update=()=>updateTime();
update();
const scheduleWeather=()=>{if(typeof window.requestIdleCallback==='function')window.requestIdleCallback(()=>getWeather(),{timeout:3000});else setTimeout(()=>getWeather(),1500)};
scheduleWeather();
const timeTimer=setInterval(updateTime,60000),weatherTimer=setInterval(getWeather,3600000);
if(navigator.permissions?.query){navigator.permissions.query({name:'geolocation'}).then(permission=>{if(!alive)return;const handle=()=>{if(permission.state==='denied')apply(timeState(),'unknown','unavailable')};permission.addEventListener?.('change',handle);weatherWatch={permission,handle};if(permission.state==='granted')getWeather();else if(permission.state==='denied')apply(timeState(),'unknown','unavailable')}).catch(()=>{})}
return()=>{alive=false;clearInterval(timeTimer);clearInterval(weatherTimer);if(weatherWatch?.permission&&weatherWatch.handle)weatherWatch.permission.removeEventListener?.('change',weatherWatch.handle)};
},[]);
return <style jsx global>{`
html[data-nyeo-time="dawn"] .livingCanvas{background:radial-gradient(ellipse at 52% 9%,rgba(255,210,167,.42),transparent 34%),radial-gradient(ellipse at 18% 66%,rgba(91,116,151,.5),transparent 52%),linear-gradient(180deg,#4e6079 0%,#283b55 52%,#17263b 100%)}
html[data-nyeo-time="morning"] .livingCanvas{background:radial-gradient(ellipse at 72% 11%,rgba(255,248,220,.76),transparent 17%),radial-gradient(ellipse at 50% 28%,rgba(177,211,235,.9),transparent 52%),linear-gradient(180deg,#78a9ca 0%,#9ec5df 42%,#577f9f 100%)}
html[data-nyeo-time="afternoon"] .livingCanvas{background:radial-gradient(ellipse at 76% 10%,rgba(255,250,226,.9),transparent 15%),radial-gradient(ellipse at 53% 23%,rgba(177,216,239,.94),transparent 50%),radial-gradient(ellipse at 18% 76%,rgba(83,132,164,.48),transparent 48%),linear-gradient(180deg,#72a8cc 0%,#a8d0e8 45%,#648faa 100%)}
html[data-nyeo-time="evening"] .livingCanvas{background:radial-gradient(ellipse at 72% 16%,rgba(255,189,135,.62),transparent 22%),radial-gradient(ellipse at 48% 35%,rgba(119,139,174,.58),transparent 52%),linear-gradient(180deg,#45577b 0%,#5d6f91 48%,#1d2a42 100%)}
html[data-nyeo-time="night"] .livingCanvas{background:radial-gradient(ellipse at 50% 8%,rgba(28,53,97,.5),transparent 45%),radial-gradient(ellipse at 15% 65%,rgba(9,28,59,.55),transparent 52%),#050a14}
html[data-nyeo-time="morning"] .skyGlow,html[data-nyeo-time="afternoon"] .skyGlow{background:radial-gradient(circle at 76% 10%,rgba(255,255,241,.38),transparent 11%),radial-gradient(ellipse at 46% 25%,rgba(238,249,255,.28),transparent 44%),radial-gradient(ellipse at 16% 76%,rgba(78,126,160,.12),transparent 45%);animation:skyDrift 52s ease-in-out infinite}
html[data-nyeo-time="dawn"] .skyGlow,html[data-nyeo-time="evening"] .skyGlow{background:radial-gradient(ellipse at 72% 15%,rgba(255,201,151,.16),transparent 24%),radial-gradient(ellipse at 40% 35%,rgba(210,224,244,.1),transparent 45%)}
html[data-nyeo-time="afternoon"] .cloud{opacity:.22;filter:blur(28px);background:radial-gradient(ellipse at 17% 54%,rgba(255,255,255,.8),transparent 39%),radial-gradient(ellipse at 38% 32%,rgba(248,252,255,.72),transparent 43%),radial-gradient(ellipse at 63% 43%,rgba(224,240,249,.7),transparent 45%),radial-gradient(ellipse at 84% 61%,rgba(206,229,242,.55),transparent 42%);box-shadow:0 28px 55px rgba(46,87,116,.14)}
html[data-nyeo-time="morning"] .cloud{opacity:.18;filter:blur(30px)}
html[data-nyeo-time="afternoon"] .skyVignette{background:linear-gradient(to bottom,rgba(20,54,79,.02),rgba(22,56,79,.06)),radial-gradient(ellipse at center,transparent 34%,rgba(18,54,76,.13) 100%)}
html[data-nyeo-time="morning"] .skyVignette{background:linear-gradient(to bottom,rgba(20,54,79,.02),rgba(22,56,79,.08)),radial-gradient(ellipse at center,transparent 34%,rgba(18,54,76,.15) 100%)}
html[data-nyeo-time="afternoon"] .cloudA{animation-duration:54s}html[data-nyeo-time="afternoon"] .cloudB{animation-duration:68s}html[data-nyeo-time="afternoon"] .cloudC{animation-duration:76s}html[data-nyeo-time="afternoon"] .cloudD{animation-duration:84s}
html[data-nyeo-weather="cloudy"] .cloud{opacity:.28}html[data-nyeo-weather="rain"] .cloud{opacity:.34}html[data-nyeo-weather="storm"] .cloud{opacity:.4}html[data-nyeo-weather="clear"] .cloud{opacity:.12}
html[data-nyeo-weather="rain"] .skyGlow{animation-duration:70s}html[data-nyeo-weather="storm"] .skyGlow{animation-duration:82s}
html[data-nyeo-weather="storm"] .skyVignette{background:linear-gradient(to bottom,rgba(2,8,18,.18),rgba(2,8,18,.3)),radial-gradient(ellipse at center,transparent 32%,rgba(2,8,18,.42) 100%)}
html[data-nyeo-time="night"] .skyVignette{background:linear-gradient(to bottom,rgba(2,5,12,.18),rgba(2,5,12,.34)),radial-gradient(ellipse at center,transparent 38%,rgba(2,5,12,.5) 100%)}
html[data-nyeo-time="dawn"] .ariaBrand,html[data-nyeo-time="evening"] .ariaBrand{text-shadow:0 0 22px rgba(214,184,106,.08),0 0 54px rgba(143,175,214,.05)}html[data-nyeo-time="night"] .ariaBrand{opacity:.7}


@media(prefers-reduced-motion:reduce){html .livingCanvas *,html .ariaBrand{animation:none!important}}
`}</style>;
}
