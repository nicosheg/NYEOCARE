// lib/nameIntelligence.js
import{normalizeName,fuzzyMatch}from'./scanValidation';
const VARIANTS={cze:'eze',tonna:'tonia',tonya:'tonia',nicolas:'nicholas',nikolas:'nicholas',nicolaus:'nicholas',jonathon:'jonathan',jonothan:'jonathan',micheal:'michael',micheal:'michael',mohamad:'mohammed',mohammed:'muhammad',muhammd:'muhammad',chinedu:'chinedu',chukwuemeka:'chukwuemeka',chukwudi:'chukwudi',chukwuma:'chukwuma',ebuka:'ebuka',emeka:'emeka',eze:'eze',ify:'ify',ife:'ife',kene:'kene',kenechukwu:'kenechukwu',ngozi:'ngozi',nnenna:'nnenna',obinna:'obinna',ochuko:'ochuko',olamide:'olamide',olaoluwa:'olaoluwa',opeyemi:'opeyemi',tosin:'tosin',tope:'tope',tunde:'tunde',yemisi:'yemisi',yewande:'yewande',ade:'ade',adedayo:'adedayo',adekunle:'adekunle',adewale:'adewale',adeola:'adeola',adeyemi:'adeyemi',ayo:'ayo',ayodeji:'ayodeji',ayomide:'ayomide',bolanle:'bolanle',bukola:'bukola',chiamaka:'chiamaka',chioma:'chioma',chinonso:'chinonso',damilola:'damilola',daniel:'daniel',david:'david',deborah:'deborah',esther:'esther',faith:'faith',grace:'grace',isaac:'isaac',james:'james',jennifer:'jennifer',john:'john',joseph:'joseph',joshua:'joshua',judith:'judith',mary:'mary',michael:'michael',moses:'moses',naomi:'naomi',paul:'paul',peter:'peter',rachel:'rachel',ruth:'ruth',samuel:'samuel',sarah:'sarah',stephen:'stephen',victor:'victor',wisdom:'wisdom'};
const KNOWN=[...new Set(Object.values(VARIANTS))];
export function canonicalNameSuggestion(name){
 const key=normalizeName(name);if(!key)return[];
 const direct=VARIANTS[key];if(direct&&direct!==key)return[{name:direct,score:100,reason:'known name variant'}];
 const parts=key.split(/\s+/),out=[];
 for(const value of KNOWN){
  if(value===key)continue;
  const score=Math.round(fuzzyMatch(key,value)*100);
  if(score>=82)out.push({name:value,score,reason:'possible name reading'});
 }
 return out.sort((a,b)=>b.score-a.score).slice(0,3);
}
export function buildNameReview(name,existingCandidates=[]){
 const suggestions=canonicalNameSuggestion(name);
 const candidateNames=(existingCandidates||[]).map(x=>({name:x.name,score:x.name_score||x.score||0,reason:'existing person'}));
 const merged=[...candidateNames,...suggestions].sort((a,b)=>b.score-a.score);
 const seen=new Set(),unique=[];
 for(const item of merged){const k=normalizeName(item.name);if(!k||seen.has(k))continue;seen.add(k);unique.push(item)}
 return unique.slice(0,5);
}
