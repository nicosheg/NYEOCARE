// components/NyeoEnvironment.js
import{useEffect}from'react';

const weatherState=c=>{
if(c==null)return'unknown';
c=Number(c);
if([95,96,99].includes(c))return'storm';
if((c>=51&&c<=67)||(c>=80&&c<=82))return'rain';
if((c>=71&&c<=77)||c===85||c===86)return'cloudy';
if(c===45||c===48)return'cloudy';
return'clear';
};

const timeState=()=>{
const h=new Date().getHours();
return h>=5&&h<8?'dawn':h>=8&&h<12?'morning':h>=12&&h<17?'afternoon':h>=17&&h<21?'evening':'night';
};

const timeIntensity={
dawn:.72,
morning:.94,
afternoon:1,
evening:.78,
night:.48
};

const weatherIntensity={
clear:1,
cloudy:.82,
rain:.64,
storm:.48,
unknown:.9
};

export default function NyeoEnvironment(){
useEffect(()=>{
let alive=true;
let weatherWatch=null;

const apply=(time,weather='unknown')=>{
if(!alive)return;
const root=document.documentElement;
const intensity=(timeIntensity[time]||.8)*(weatherIntensity[weather]||.8);
root.dataset.nyeoTime=time;
root.dataset.nyeoWeather=weather;
root.style.setProperty('--ny-environment-time',`'${time}'`);
root.style.setProperty('--ny-weather',`'${weather}'`);
root.style.setProperty('--ny-environment-intensity',String(intensity));
root.style.setProperty('--ny-environment-warmth',time==='dawn'||time==='evening'?'1':'0');
root.style.setProperty('--ny-environment-dim',time==='night'?'1':'0');
};

const updateTime=()=>apply(timeState(),document.documentElement.dataset.nyeoWeather||'unknown');

const getWeather=()=>{
if(!navigator.geolocation)return;
navigator.geolocation.getCurrentPosition(async pos=>{
if(!alive)return;
try{
const{latitude,longitude}=pos.coords;
const r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&timezone=auto`);
if(!r.ok)return;
const d=await r.json();
if(!alive)return;
apply(timeState(),weatherState(d.current?.weather_code));
}catch{}
},()=>{},{
enableHighAccuracy:false,
maximumAge:3600000,
timeout:7000
});
};

const update=()=>{
updateTime();
getWeather();
};

update();

const timeTimer=setInterval(updateTime,60000);
const weatherTimer=setInterval(getWeather,3600000);

if(navigator.permissions?.query){
navigator.permissions.query({name:'geolocation'}).then(permission=>{
if(!alive)return;
const handle=()=>{if(permission.state==='granted')getWeather()};
permission.addEventListener?.('change',handle);
weatherWatch={permission,handle};
if(permission.state==='granted')getWeather();
}).catch(()=>{});
}

return()=>{
alive=false;
clearInterval(timeTimer);
clearInterval(weatherTimer);
if(weatherWatch?.permission&&weatherWatch.handle)weatherWatch.permission.removeEventListener?.('change',weatherWatch.handle);
};
},[]);

return <style jsx global>{`
html[data-nyeo-time="dawn"] .livingCanvas{background:radial-gradient(ellipse at 50% 8%,rgba(72,78,116,.42),transparent 45%),radial-gradient(ellipse at 18% 65%,rgba(30,48,80,.48),transparent 52%),#070d1d}
html[data-nyeo-time="morning"] .livingCanvas{background:radial-gradient(ellipse at 50% 8%,rgba(38,64,103,.42),transparent 45%),radial-gradient(ellipse at 15% 65%,rgba(18,42,75,.5),transparent 52%),#070d1d}
html[data-nyeo-time="afternoon"] .livingCanvas{background:radial-gradient(ellipse at 50% 8%,rgba(44,69,108,.5),transparent 45%),radial-gradient(ellipse at 15% 65%,rgba(19,45,79,.5),transparent 52%),#070d1d}
html[data-nyeo-time="evening"] .livingCanvas{background:radial-gradient(ellipse at 50% 12%,rgba(65,55,79,.42),transparent 45%),radial-gradient(ellipse at 15% 65%,rgba(25,35,67,.52),transparent 52%),#070d1d}
html[data-nyeo-time="night"] .livingCanvas{background:radial-gradient(ellipse at 50% 8%,rgba(23,39,76,.4),transparent 45%),radial-gradient(ellipse at 15% 65%,rgba(9,25,55,.52),transparent 52%),#050a14}
html[data-nyeo-weather="cloudy"] .cloud{opacity:.14}
html[data-nyeo-weather="rain"] .cloud{opacity:.19}
html[data-nyeo-weather="storm"] .cloud{opacity:.25}
html[data-nyeo-weather="clear"] .cloud{opacity:.075}
html[data-nyeo-weather="rain"] .skyGlow{animation-duration:58s}
html[data-nyeo-weather="storm"] .skyGlow{animation-duration:72s}
html[data-nyeo-weather="storm"] .skyVignette{background:linear-gradient(to bottom,rgba(2,5,12,.2),rgba(2,5,12,.38)),radial-gradient(ellipse at center,transparent 32%,rgba(2,5,12,.55) 100%)}
html[data-nyeo-time="night"] .skyVignette{background:linear-gradient(to bottom,rgba(2,5,12,.18),rgba(2,5,12,.34)),radial-gradient(ellipse at center,transparent 38%,rgba(2,5,12,.5) 100%)}
html[data-nyeo-time="dawn"] .ariaBrand,html[data-nyeo-time="evening"] .ariaBrand{text-shadow:0 0 22px rgba(214,184,106,.08),0 0 54px rgba(143,175,214,.05)}
html[data-nyeo-time="night"] .ariaBrand{opacity:.7}
@media(prefers-reduced-motion:reduce){
html .livingCanvas *,html .ariaBrand{animation:none!important}
}
`}</style>;
  }
