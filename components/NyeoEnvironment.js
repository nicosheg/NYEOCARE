// components/NyeoEnvironment.js
import{useEffect}from'react';

const weatherState=c=>{
if(c==null)return'unknown';
if(c>=95)return'storm';
if(c>=80)return'rain';
if(c>=45)return'cloudy';
return'clear';
};

export default function NyeoEnvironment(){
useEffect(()=>{
let alive=true;
const apply=(time,weather='unknown')=>{
if(!alive)return;
const root=document.documentElement;
root.dataset.nyeoTime=time;
root.dataset.nyeoWeather=weather;
root.style.setProperty('--ny-environment-time',`'${time}'`);
root.style.setProperty('--ny-weather',`'${weather}'`);
};
const getTime=()=>{
const h=new Date().getHours();
return h>=5&&h<8?'dawn':h>=8&&h<12?'morning':h>=12&&h<17?'afternoon':h>=17&&h<21?'evening':'night';
};
const updateTime=()=>apply(getTime(),document.documentElement.dataset.nyeoWeather||'unknown');
const weather=async()=>{
try{
if(!navigator.permissions?.query)return;
const p=await navigator.permissions.query({name:'geolocation'});
if(p.state!=='granted')return;
navigator.geolocation.getCurrentPosition(async pos=>{
try{
const{latitude,longitude}=pos.coords;
const r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&timezone=auto`);
if(!r.ok)return;
const d=await r.json();
const w=weatherState(Number(d.current?.weather_code));
apply(getTime(),w);
}catch{}
},{enableHighAccuracy:false,maximumAge:3600000,timeout:5000});
}catch{}
};
updateTime();
weather();
const t=setInterval(updateTime,60000);
return()=>{alive=false;clearInterval(t)};
},[]);
return null;
}
