// Explicit bulk People type intent parser.
// This changes the People directory classification (visitor/member), not operator permissions.
const VERB='(?:mark|make|set|change|update|convert|turn)';
const END='\\s*(?:please)?[.!?]*$';

function normalizeType(value){
 const type=String(value||'').toLowerCase().replace(/s$/,'');
 return ['member','visitor'].includes(type)?type:null;
}

export function inferBulkPeopleTypeIntent(input){
 const text=String(input||'').trim().replace(/\s+/g,' ');
 if(!text||text.length>240)return null;

 // Handle subject-first corrections people naturally use after an initial misunderstanding:
 // "Everyone who's a visitor now make them members" and
 // "I mean the people who are marked as visitors should be members".
 const sourceFirstMatch = text.match(/^(?:(?:please|actually|no|rather|i mean|i meant)\s+)?(?:everyone|everybody|(?:all|every|each)\s+(?:(?:active|current)\s+)?(?:of\s+)?(?:the\s+)?(?:people|persons?|records?)|(?:the\s+)?(?:people|persons?|records?))\s+(?:(?:who\s*(?:is|are|['’]s)|that\s+(?:is|are))\s+)?(?:(?:are|is)\s+)?(?:marked\s+as\s+)?(?:a\s+|an\s+|the\s+)?(members?|visitors?)\s+(?:(?:now|please)\s+)?(?:(?:make|mark|set|change|update|convert|turn)\s+(?:(?:them|these|those|all|everyone|everybody)\s+)?|(?:should|must|need\s+to|ought\s+to)\s+(?:be|become)\s+)(?:(?:as|to|into|become)\s+)?(?:a\s+|an\s+|the\s+)?(members?|visitors?)\s*(?:please)?[.!?]*$/i);
 if(sourceFirstMatch){
  const sourceType=normalizeType(sourceFirstMatch[1]);
  const targetType=normalizeType(sourceFirstMatch[2]);
  if(sourceType&&targetType&&sourceType!==targetType)return{target_type:targetType,source_type:sourceType,scope:'all_active_people',explicit:true};
 }

 // Source-specific commands: "make every visitor a member",
 // "mark everyone who's visitor to be members", and
 // "convert all people who are visitors into members".
 const sourcePattern=new RegExp(
  '^(?:please\\s+)?'+VERB+'\\s+'+
  '(?:(?:all|every|each)\\s+(?:(?:active|current)\\s+)?(?:of\\s+)?(?:the\\s+)?|(?:everyone|everybody)\\s+)'+
  '(?:(?:people|persons?|records?)\\s+)?'+
  '(?:(?:who(?:\\s+is|\\s+are|\\u0027s)|that\\s+is|that\\s+are)\\s+)?'+
  '(?:a\\s+|an\\s+|the\\s+)?(members?|visitors?)'+
  '(?:\\s+(?:people|persons?|records?))?\\s+'+
  '(?:(?:as|to\\s+be|to|into|become)\\s+)?(?:a\\s+|an\\s+)?(members?|visitors?)'+END,
  'i'
 );
 let match=text.match(sourcePattern);
 if(match){
  const sourceType=normalizeType(match[1]);
  const targetType=normalizeType(match[2]);
  if(sourceType&&targetType)return{target_type:targetType,source_type:sourceType,scope:'all_active_people',explicit:true};
 }

 // Whole-directory commands: "mark all the people as members",
 // "make everyone a member", or "set all active records to visitors".
 const targetPattern=new RegExp(
  '^(?:please\\s+)?'+VERB+'\\s+'+
  '(?:everyone|everybody|all(?:\\s+of\\s+(?:them|the\\s+people))?|'+
  '(?:all|every|each)\\s+(?:(?:active|current)\\s+)?(?:of\\s+)?(?:the\\s+)?(?:people|persons?|records?))'+
  '\\s+(?:(?:as|to\\s+be|to|into|become)\\s+)?(?:a\\s+|an\\s+)?(members?|visitors?)'+END,
  'i'
 );
 match=text.match(targetPattern);
 if(match){
  const targetType=normalizeType(match[1]);
  if(targetType)return{target_type:targetType,source_type:null,scope:'all_active_people',explicit:true};
 }

 // Keep the prior strict form as a fallback for unambiguous commands.
 const legacy=text.match(/^(?:please\s+)?(?:mark|make|set|change|update|convert)\s+(?:all|every|everyone|everybody|all of them)(?:\s+(?:(?:of\s+)?(?:the\s+)?)(people|persons?|members?|visitors?|records?))?\s+(?:(?:as|to)\s+)?(?:a\s+)?(members?|visitors?)\s*(?:please)?[.!?]*$/i);
 if(!legacy)return null;
 const subject=String(legacy[1]||'').toLowerCase().replace(/s$/,'');
 const targetType=normalizeType(legacy[2]);
 const sourceType=['member','visitor'].includes(subject)?subject:null;
 if(!targetType)return null;
 return{target_type:targetType,source_type:sourceType,scope:'all_active_people',explicit:true};
}


 // Read-only directory lookup, intentionally separate from bulk mutation intent.
 export function inferPeopleTypeListIntent(input){
  const text=String(input||'').trim().replace(/\s+/g,' ');
  if(!text||text.length>240)return null;
  // Explicit mutations must always use the confirmation-gated parser above.
  if(inferBulkPeopleTypeIntent(text))return null;
  if(/\b(?:i want|i need)\s+(?:aria|you)\s+to\s+(?:support|learn|understand|recognize)\b/i.test(text))return null;
  const match=text.match(/\b(visitors?|members?)\b/i);
  if(!match)return null;
  const readIntent=/\b(?:list|show|display|find|identify|pull up|fetch|view|retrieve|look up|give me|tell me|see)\b/i.test(text)
   ||/\bwho\s+(?:is|are)\b/i.test(text)
   ||/\bwhich\s+(?:people|persons?|members?|visitors?)\b/i.test(text);
  if(!readIntent)return null;
  const type=normalizeType(match[1]);
  if(!type)return null;
  return{cohort:type==='visitor'?'visitors':'members',type,explicit:false};
}
