// components/ClientErrorBoundary.js
import React from'react';

export default class ClientErrorBoundary extends React.Component{
 constructor(props){super(props);this.state={hasError:false,error:null};}
 static getDerivedStateFromError(error){return{hasError:true,error};}
 componentDidUpdate(prevProps){
  if(this.state.hasError&&prevProps.resetKey!==this.props.resetKey)this.setState({hasError:false,error:null});
 }
 componentDidCatch(error,info){
  const payload={surface:String(this.props.surface||'app'),message:String(error?.message||error||'Unknown client error').slice(0,2000),stack:String(error?.stack||'').slice(0,6000),componentStack:String(info?.componentStack||'').slice(0,6000),pathname:typeof window!=='undefined'?window.location.pathname:''};
  console.error('[NYEOCARE] Client error boundary caught:',payload);
  try{fetch('/api/diagnostics/client-error',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),keepalive:true}).catch(()=>{})}catch{}
 }
 recover=()=>{if(typeof window!=='undefined')window.location.reload()};
 render(){
  if(this.state.hasError){
   if(this.props.fallback)return typeof this.props.fallback==='function'?this.props.fallback(this.state.error):this.props.fallback;
   return <main style={{minHeight:'100dvh',display:'grid',placeItems:'center',padding:'28px',background:'var(--ny-bg)',color:'var(--ny-text)'}}><section style={{width:'min(520px,100%)',padding:'28px',border:'1px solid var(--ny-border)',borderRadius:'var(--ny-radius-major)',background:'var(--ny-surface)',boxShadow:'var(--ny-shadow-xl)',textAlign:'center'}}><div style={{fontSize:10,letterSpacing:3,color:'var(--ny-text-whisper)',marginBottom:12}}>NYEOCARE</div><h1 style={{margin:'0 0 10px',fontSize:24}}>Something went wrong.</h1><p style={{margin:'0 auto 20px',maxWidth:410,color:'var(--ny-text-muted)',lineHeight:1.6,fontSize:14}}>The current screen hit an unexpected error. Your server-side data is not deleted by a client display error.</p><button onClick={this.recover} style={{padding:'11px 18px',border:0,borderRadius:999,background:'var(--ny-text)',color:'var(--ny-bg)',fontWeight:700,cursor:'pointer'}}>Reload NYEOCARE</button></section></main>;
  }
  return this.props.children;
 }
}
