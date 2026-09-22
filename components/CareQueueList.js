// components/CareQueueList.js
// Homepage action layer: "What should I do?"

import{useCallback,useEffect,useState}from'react';
import{useRouter}from'next/router';
import{supabase}from'../lib/supabaseClient';

const rank={critical:4,high:3,medium:2,low:1};

export default function CareQueueList(){
  const router=useRouter();
  const[items,setItems]=useState([]);
  const[loading,setLoading]=useState(true);

  const load=useCallback(async()=>{
    try{
      const{data:{session}}=await supabase.auth.getSession();
      if(!session){setItems([]);return;}

      const res=await fetch('/api/care-queue',{
        headers:{Authorization:`Bearer ${session.access_token}`}
      });

      if(!res.ok)throw new Error('Care queue request failed');
      const data=await res.json();
      setItems(Array.isArray(data)?data:[]);
    }catch(err){
      console.error('[ARIA] Care Queue:',err);
      setItems([]);
    }finally{
      setLoading(false);
    }
  },[]);

  useEffect(()=>{load();},[load]);

  if(loading)return(
    <section style={{margin:'42px 0'}}>
      <div className="fiducia-card shimmer" style={{height:150,borderRadius:28}}/>
    </section>
  );

  return(
    <section style={{margin:'42px 0'}}>
      <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',marginBottom:16}}>
        <div>
          <div style={{fontSize:12,letterSpacing:2,textTransform:'uppercase',color:'rgba(255,255,255,.38)',marginBottom:6}}>
            ARIA
          </div>
          <h2 style={{fontSize:25,fontWeight:600,color:'#f0f0f0',margin:0}}>
            What’s next?
          </h2>
        </div>
        {items.length>0&&(
          <span style={{fontSize:13,color:'rgba(255,255,255,.4)'}}>
            {items.length} {items.length===1?'thing':'things'} worth your attention
          </span>
        )}
      </div>

      {!items.length?(
        <div className="fiducia-card" style={{padding:'26px 24px',borderRadius:26}}>
          <div style={{fontSize:18,color:'#f0f0f0',marginBottom:7}}>
            Nothing needs you right now.
          </div>
          <div style={{fontSize:15,lineHeight:1.6,color:'rgba(255,255,255,.5)'}}>
            ARIA is watching for meaningful changes and will surface a signal when there is enough evidence.
          </div>
        </div>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {items.slice(0,5).map((item,idx)=>{
            const level=item.priority||'low';
            const label=
              level==='critical'?'Needs attention now':
              level==='high'?'Worth your attention':
              level==='medium'?'Worth checking':'Keep an eye on this';

            return(
              <div
                key={item.id||item.person_id||idx}
                className="fiducia-card"
                style={{padding:'18px 20px',borderRadius:24}}
              >
                <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
                  <span style={{
                    width:8,height:8,borderRadius:'50%',marginTop:7,flexShrink:0,
                    background:level==='critical'?'#EF4444':level==='high'?'#F59E0B':level==='medium'?'#FBBF24':'#34D399'
                  }}/>

                  <div style={{minWidth:0,flex:1}}>
                    <div style={{fontSize:12,letterSpacing:.5,color:'rgba(255,255,255,.4)',marginBottom:5}}>
                      {label}
                    </div>

                    <div style={{fontSize:17,lineHeight:1.45,color:'#f0f0f0'}}>
                      {item.first_name?`${item.first_name} — `:''}{item.text}
                    </div>

                    {item.evidence?.inference&&(
                      <div style={{fontSize:13,lineHeight:1.5,color:'rgba(255,255,255,.42)',marginTop:6}}>
                        {item.evidence.inference}
                      </div>
                    )}

                    <div style={{fontSize:14,color:'rgba(255,255,255,.62)',marginTop:11}}>
                      <span style={{color:'#f0f0f0'}}>Next:</span> {item.suggestion}
                    </div>

                    {item.confidence!=null&&(
                      <div style={{fontSize:11,color:'rgba(255,255,255,.3)',marginTop:7}}>
                        Signal confidence {Math.round(Number(item.confidence)*100)}%
                      </div>
                    )}
                  </div>

                  <button
                    className="fiducia-button fiducia-button-ghost"
                    style={{padding:'7px 12px',fontSize:12,flexShrink:0}}
                    onClick={()=>router.push(`/person/${encodeURIComponent(item.person_id)}`)}
                  >
                    View
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
                                         }
