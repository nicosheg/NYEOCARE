// Explicit bulk People type intent parser.
export function inferBulkPeopleTypeIntent(input){
 const text=String(input||'').trim();
 const match=text.match(/^(?:please\s+)?(?:mark|make|set|change|update|convert)\s+(?:all|every|everyone|everybody|all of them)(?:\s+(?:(?:of\s+)?(?:the\s+)?)(people|persons?|members?|visitors?|records))?\s+(?:(?:as|to)\s+)?(?:a\s+)?(members?|visitors?)\s*(?:please)?[.!?]*$/i);
 if(!match)return null;
 const subject=String(match[1]||'').toLowerCase().replace(/s$/,'');
 const targetType=String(match[2]||'').toLowerCase().replace(/s$/,'');
 const sourceType=['member','visitor'].includes(subject)?subject:null;
 if(!['member','visitor'].includes(targetType))return null;
 return{target_type:targetType,source_type:sourceType,scope:'all_active_people',explicit:true};
}
