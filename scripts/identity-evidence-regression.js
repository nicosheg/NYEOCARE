// scripts/identity-evidence-regression.js
import{scoreIdentityEvidence}from'../lib/identityResolver.js';
function assert(condition,message){if(!condition)throw new Error(message)}
const person=(name,phone,extra={})=>({name,phone_numbers:phone?[phone]:[],name_evidence:'clear',phone_evidence:phone?'clear':'unreadable',pair_evidence:'clear',...extra});
const row=(name,phone,id)=>({id,display_name:name,phone,phone_numbers:phone?[phone]:[],identity_verification_status:'verified',metadata:{identity_verified:true},status:'active'});
const ngozi=scoreIdentityEvidence(person('Sis Ngozi','+2347079354042'),row('Sis Ngozi','+2349079354042','a'));
assert(ngozi.name_score===100,'Honorific-insensitive exact name should remain 100.');
assert(ngozi.phone_score<100&&ngozi.phone_accuracy<100,'A changed phone digit must never be treated as exact.');
assert(ngozi.score===Math.round((ngozi.name_score+ngozi.phone_score)/2),'Identity evidence must be balanced 50/50.');
const nameOnly=scoreIdentityEvidence(person('Ngozi',null),row('Sis Ngozi','+2349079354042','b'));
assert(nameOnly.name_score===100&&nameOnly.phone_score===0&&nameOnly.score===50,'Name-only evidence must not behave like a full identity match.');
const blessing=scoreIdentityEvidence(person('Sister Blessing',null),row('Blessing Emelile','+2342066199143','c'));
assert(blessing.score<60,'A shared first name alone must remain weak under the balanced model.');
console.log('[IDENTITY EVIDENCE] 50/50 checks passed.');
