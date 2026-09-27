// pages/_document.js
import Document,{Html,Head,Main,NextScript}from'next/document';

const EARLY_RECOVERY_SCRIPT=String.raw`(function(){
  try{
    var KEY='nyeocare:early-client-recovery:v1';
    var isRecoverable=function(message){
      return /ChunkLoadError|Loading chunk|dynamically imported module|Failed to fetch dynamically imported module|Importing a module script failed|Unexpected token '<'/i.test(String(message||''));
    };
    var recover=function(message){
      if(!isRecoverable(message))return;
      try{
        if(sessionStorage.getItem(KEY)==='1')return;
        sessionStorage.setItem(KEY,'1');
      }catch{}
      try{
        var url=new URL(location.href);
        url.searchParams.set('_nyeo_recover','1');
        location.replace(url.toString());
      }catch{location.reload();}
    };
    window.addEventListener('error',function(event){
      recover(event&&((event.error&&event.error.message)||event.message));
    },true);
    window.addEventListener('unhandledrejection',function(event){
      recover(event&&((event.reason&&event.reason.message)||event.reason));
    });
    window.addEventListener('load',function(){
      setTimeout(function(){try{sessionStorage.removeItem(KEY)}catch{}},12000);
    });
  }catch{}
})();`;

export default class MyDocument extends Document{
 render(){
  return <Html><Head><script dangerouslySetInnerHTML={{__html:EARLY_RECOVERY_SCRIPT}}/></Head><body><Main/><NextScript/></body></Html>;
 }
}
