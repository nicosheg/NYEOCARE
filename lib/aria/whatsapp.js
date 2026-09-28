// lib/aria/whatsapp.js
const clean=(value,max=300)=>String(value??'').trim().replace(/\s+/g,' ').slice(0,max);

const NIGERIA_MOBILE_ACCESS_CODES=new Set([
 '701','703','704','705','706','707','708',
 '801','802','803','804','805','806','807','808','809',
 '810','811','812','813','814','815','816','817','818',
 '901','902','903','904','905','906','907','908','909',
 '911','912','913','915','916'
]);

const HONORIFICS=[
 'sister','brother','mrs','mr','ms','miss','dr','pastor','past','rev','revd',
 'bishop','apostle','prophet','deaconess','deacon','elder','sis','bro',
 'mama','mummy','daddy','uncle','aunty','auntie','chief','hon','alhaji','alhaja',
 'engr','eng','prof','pr'
];

const honorificPattern=new RegExp('^('+HONORIFICS.join('|')+')(?:\\.|\\b)[\\s-]*','i');
const addressClean=value=>clean(value,160).replace(/[,;:]+/g,' ').replace(/\s+/g,' ').trim();
const ESCAPABLE='\\^$*+?.()|{}[]';
const escapeRegex=value=>String(value||'').split('').map(ch=>ESCAPABLE.includes(ch)?'\\'+ch:ch).join('');
const leadingNamedSalutation=new RegExp('^(?:'+HONORIFICS.join('|')+')(?:\\.|\\b)[\\s-]+[A-Z][^,\\n]{1,100},\\s*','i');

export function normalizeWhatsAppPhone(raw){
 const original=clean(raw,80);
 if(!original)return{valid:false,reason:'missing',e164:null,waNumber:null};
 let digits=original.replace(/[^\d]/g,'');
 if(digits.startsWith('00'))digits=digits.slice(2);
 if(digits.startsWith('0')&&digits.length===11)digits='234'+digits.slice(1);
 if(digits.startsWith('234')){ 
  const subscriber=digits.slice(3);
  if(subscriber.length!==10)return{valid:false,reason:'invalid_length',e164:null,waNumber:null};
  if(!NIGERIA_MOBILE_ACCESS_CODES.has(subscriber.slice(0,3))){
   return{valid:false,reason:'unallocated_or_non_mobile_ng_range',e164:null,waNumber:null};
  }
  return{valid:true,reason:null,e164:'+'+digits,waNumber:digits};
 }
 if(!/^[1-9]\d{7,14}$/.test(digits))return{valid:false,reason:'invalid_international_number',e164:null,waNumber:null};
 return{valid:true,reason:null,e164:'+'+digits,waNumber:digits};
}

export function whatsappChatUrl(raw,message=''){
 const normalized=normalizeWhatsAppPhone(raw);
 if(!normalized.valid)return null;
 const encoded=String(message||'').trim();
 return encoded
  ? 'https://wa.me/'+normalized.waNumber+'?text='+encodeURIComponent(encoded)
  : 'https://wa.me/'+normalized.waNumber;
}

export function getHonorific(person={}){
 const metadata=person?.metadata&&typeof person.metadata==='object'?person.metadata:{};
 const explicit=clean(metadata.honorific,40);
 if(explicit)return explicit.replace(/[.]$/,'');
 const display=clean(person?.display_name||'',160);
 const match=display.match(honorificPattern);
 return match?.[1] ? clean(match[1],40).replace(/[.]$/,'') : null;
}

export function getAddressName(person={}){
 const display=clean(person?.display_name||'',160);
 const honorific=getHonorific(person);
 let name=display;
 if(honorific){
  const fromDisplay=display.replace(honorificPattern,'').trim();
  if(fromDisplay)name=fromDisplay;
  else{
   const first=clean(person?.first_name,80);
   const last=clean(person?.last_name,100);
   name=[first,last].filter(Boolean).join(' ').trim();
  }
  return addressClean(honorific+' '+(name||display||person?.first_name||'there'));
 }
 return addressClean(name||[person?.first_name,person?.last_name].filter(Boolean).join(' ')||'there');
}

function stripGeneratedSalutations(value,address){
 let body=clean(value,1500);
 for(let i=0;i<5;i++){
  const before=body;
  const exact=new RegExp('^'+escapeRegex(address)+',\\s*','i');
  body=body.replace(exact,'');
  body=body.replace(/^(?:hi|hello|hey|dear)\\s+/i,'');
  body=body.replace(leadingNamedSalutation,'');
  if(body===before)break;
 }
 return body.trim();
}

export function personalizeWhatsAppMessage(message,person={}){
 const address=getAddressName(person);
 let body=stripGeneratedSalutations(message,address);
 if(!body)body='We appreciated having you with us.';
 return clean('Hello '+address+', '+body,240);
}

export function getWhatsAppPhone(person={}){
 const values=[];
 if(person?.phone)values.push(person.phone);
 if(Array.isArray(person?.phone_numbers)){
  for(const item of person.phone_numbers){
   if(typeof item==='string')values.push(item);
   else if(item&&typeof item==='object')values.push(item.normalized,item.raw);
  }
 }
 for(const value of values){
  const normalized=normalizeWhatsAppPhone(value);
  if(normalized.valid)return{raw:value,...normalized};
 }
 const fallback=values.find(Boolean)||null;
 return{raw:fallback,...normalizeWhatsAppPhone(fallback)};
}
