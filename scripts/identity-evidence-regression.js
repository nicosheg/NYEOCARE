// scripts/identity-evidence-regression.js
import{scoreIdentityEvidence}from'../lib/identityResolver.js';

function assert(condition,message){if(!condition)throw new Error(message)}
function person(name,phone,extra={}){return{name,phone_numbers:phone?[phone]:[],name_evidence:'clear',phone_evidence:phone?'clear':'unreadable',pair_evidence:'clear',...extra}}
function row(name,phone,id){return{id,display_name:name,phone,phone_numbers:phone?[phone]:[],identity_verification_status:'verified',metadata:{identity_verified:true},status:'active'}}

const ngozi=scoreIdentityEvidence(person('Sis Ngozi','+2347079354042'),row('Sis Ngozi','+2349079354042','a'));
assert(ngozi.name_score===100,'Honorific-insensitive exact name should remain 100.');
assert(ngozi.phone_score<100&&ngozi.phone_accuracy<100,'One changed phone digit must never be treated as exact.');
assert(Math.abs(ngozi.score-Math.round((ngozi.name_score+ngozi.phone_score)/2))<=1,'Identity score must be 50/50 balanced.');

const sameNameNoPhone=scoreIdentityEvidence(person('Ngozi',null),row('Sis Ngozi','+2349079354042','a'));
assert(sameNameNoPhone.name_score===100,'Honorific-only difference should match by name.');
assert(sameNameNoPhone.phone_score===0,'Missing phone must contribute zero phone evidence.');
assert(sameNameNoPhone.score===50,'A name-only match must cap at 50 before other evidence.');

const blessing=scoreIdentityEvidence(person('Sister Blessing',null),row('Blessing Emelile','+2342066199143','b'));
assert(blessing.name_score<88,'A one-token name must not score as a strong full-name match.');
assert(blessing.score<60,'Name-only similarity must remain weak under the 50/50 model.');

console.log('[IDENTITY EVIDENCE] 50/50 evidence regression checks passed.');
