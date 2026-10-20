// lib/scanRateLimit.js
// Groq can report a quota-specific retry hint in the response body while its
// general TPM reset headers describe a different quota. Prefer the explicit
// provider message so OTPM limits are not accidentally stretched by TPM reset.
export function parseRetryAfterSeconds(message){
 const text=String(message??'');
 const m=text.match(/(?:please\\s+)?try again in\\s+(\\d+(?:\\.\\d+)?)\\s*(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\\b/i);
 if(!m)return null;
 const amount=Number(m[1]),unit=m[2].toLowerCase();
 const multiplier=unit==='ms'||unit.startsWith('millisecond')||unit.startsWith('msec')?.001:unit.startsWith('min')||unit==='m'?60:unit.startsWith('hour')||unit==='h'||unit.startsWith('hr')?3600:1;
 return Math.max(0,amount*multiplier);
}
export function parseDurationSeconds(value){
 if(value==null)return null;
 const s=String(value).trim().toLowerCase();
 if(!s)return null;
 if(/^\\d+(?:\\.\\d+)?$/.test(s))return Number(s);
 let total=0,found=false,m;
 const re=/(\\d+(?:\\.\\d+)?)\\s*(ms|milliseconds?|msecs?|s|seconds?|secs?|m|minutes?|mins?|h|hours?|hrs?)\\b/g;
 while((m=re.exec(s))){
  found=true;
  const unit=m[2],n=Number(m[1]);
  total+=unit==='ms'||unit.startsWith('millisecond')||unit.startsWith('msec')?n/1000:unit==='m'||unit.startsWith('min')?n*60:unit==='h'||unit.startsWith('hour')||unit.startsWith('hr')?n*3600:n;
 }
 return found?total:null;
}
export function getRateLimitRetrySeconds({message,retryAfter,remainingTokens,remainingRequests,resetTokens,resetRequests}={}){
 const specific=parseRetryAfterSeconds(message);
 if(specific!==null)return Math.min(600,specific);
 const header=parseDurationSeconds(retryAfter);
 // Groq's Retry-After header is specific to the 429 and takes precedence over
 // the generic token/request reset clocks.
 if(header!==null&&header>0)return Math.min(600,header);
 const tokenRemaining=remainingTokens==null||remainingTokens===''?null:Number(remainingTokens);
 const requestRemaining=remainingRequests==null||remainingRequests===''?null:Number(remainingRequests);
 if(tokenRemaining!==null&&Number.isFinite(tokenRemaining)&&tokenRemaining<=0){
  const reset=parseDurationSeconds(resetTokens);
  if(reset!==null&&reset>0)return Math.min(600,reset);
 }
 if(requestRemaining!==null&&Number.isFinite(requestRemaining)&&requestRemaining<=0){
  const reset=parseDurationSeconds(resetRequests);
  if(reset!==null&&reset>0)return Math.min(600,reset);
 }
 // Do not use a non-exhausted TPM reset or a daily request reset to override
 // an absent quota-specific signal. A one-second conservative wait is safer.
 return 1;
}
