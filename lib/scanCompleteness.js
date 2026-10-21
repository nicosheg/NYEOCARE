// Pure, privacy-safe completeness contract shared by scan processing and regression tests.
export function classifyScanRegions(parts){
 const regions=(Array.isArray(parts)?parts:[]).map((part,index)=>{
  const people=part?.people;
  const declared=part?.completenessStatus;
  const status=['valid','confirmed_blank','empty_unconfirmed','failed'].includes(declared)
   ?declared
   :Array.isArray(people)&&people.length>0
    ?'valid'
    :Array.isArray(people)&&people.length===0
     ?'empty_unconfirmed'
     :'failed';
  const bounds=part?.region||{};
  return{
   index:Number(bounds.id)||index+1,
   bounds:{y0:Number.isFinite(Number(bounds.y0))?Number(bounds.y0):0,y1:Number.isFinite(Number(bounds.y1))?Number(bounds.y1):null},
   status,
   reason:status==='empty_unconfirmed'?'empty_people_array':status==='failed'?'invalid_people_array':null,
   row_count:Array.isArray(people)?people.length:0,
   attempt_count:Math.max(0,Number(part?.attempt_count)||1),
   finish_reason:part?.finishReason||null,
   provider_request_id:part?.requestId||null,
   error_code:status==='empty_unconfirmed'?'AI_EMPTY_REGION':status==='failed'?'AI_INVALID_RESPONSE':null
  };
 });
 const requiresConfirmation=regions.some(region=>region.status==='empty_unconfirmed');
 const complete=regions.length>0&&regions.every(region=>region.status==='valid'||region.status==='confirmed_blank');
 return{regions,requiresConfirmation,complete};
}
