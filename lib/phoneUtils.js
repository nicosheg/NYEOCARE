// lib/phoneUtils.js
function digitsOnly(v){return String(v??'').replace(/\D/g,'')}
function normalizePhone(phone){
  if(phone===null||phone===undefined)return null;
  const raw=String(phone).trim();if(!raw)return null;
  const cleaned=raw.replace(/\s+/g,'').replace(/[^0-9+]/g,'');if(!cleaned)return null;
  if(cleaned.startsWith('+')){const d=cleaned.slice(1).replace(/\D/g,'');return d.length>=10&&d.length<=15?'+'+d:null}
  if(cleaned.startsWith('234'))return/^234\d{10}$/.test(cleaned)?'+'+cleaned:null;
  if(cleaned.startsWith('0'))return/^0\d{10}$/.test(cleaned)?'+234'+cleaned.slice(1):null;
  return/^\d{10}$/.test(cleaned)?'+234'+cleaned:null;
}
function normalizePhoneList(source,{limit=4}={}){
  const values=[];
  if(Array.isArray(source?.phone_numbers))values.push(...source.phone_numbers);
  if(Array.isArray(source?.phones))values.push(...source.phones);
  if(source?.phone)values.push(source.phone);
  return[...new Set(values.map(v=>typeof v==='string'?v:v?.normalized||v?.raw||v?.phone).map(normalizePhone).filter(Boolean))].slice(0,limit);
}
function nigerianLocalDigits(normalized){const d=digitsOnly(normalized);return d.startsWith('234')&&d.length===13?'0'+d.slice(3):d.length===11?d:null}
export const NIGERIAN_MOBILE_PREFIXES=Object.freeze(['070','080','081','090','091']);
const NIGERIAN_MOBILE_PREFIX_SET=new Set(NIGERIAN_MOBILE_PREFIXES);
export function analyzeNigerianPhone(value){const normalized=normalizePhone(value),local=nigerianLocalDigits(normalized),flags=[];if(!normalized)return{valid:false,normalized:null,digits:null,prefix_valid:false,format_valid:false,flags:['phone_not_readable']};const d=digitsOnly(normalized),formatValid=d.length===13&&d.startsWith('234'),localDigits=local||'',prefixValid=localDigits.length===11&&NIGERIAN_MOBILE_PREFIX_SET.has(localDigits.slice(0,3));if(!formatValid)flags.push('invalid_phone_length');if(!prefixValid)flags.push('invalid_nigerian_mobile_prefix');if(/^(\d)\1+$/.test(localDigits||d))flags.push('invalid_repeated_digits');return{valid:formatValid&&prefixValid&&!flags.includes('invalid_repeated_digits'),normalized,digits:d,local_digits:localDigits,prefix_valid:prefixValid,format_valid:formatValid,flags}}
export function phoneDigitSimilarity(a,b){const x=digitsOnly(a),y=digitsOnly(b);if(!x||!y)return 0;if(x===y)return 100;const m=Math.max(x.length,y.length);let same=0;for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]===y[i])same++;let suffix=0;for(let i=1;i<=Math.min(6,x.length,y.length);i++){if(x.slice(-i)===y.slice(-i))suffix=i;else break}const lengthPenalty=Math.abs(x.length-y.length)*18;return Math.max(0,Math.min(100,Math.round((same/m)*100-lengthPenalty+suffix*2)))}
export {normalizePhone,normalizePhoneList};export default normalizePhone;
