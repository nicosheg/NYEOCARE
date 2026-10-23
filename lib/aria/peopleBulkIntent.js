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
  '^'+VERB+'\\s+'+
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
