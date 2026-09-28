import{parsePeopleRoster,inferPeopleRosterIntent}from'../lib/aria/peopleRosterParser.js';
const multiline="And this the name's and phone number of our women that are not in the church service today,\n\nMummy Christiana\n08022597401\n\nSIS Sandra Isiocha\n08039579758\nPlease she's very strong,\n\nSIS Ruth nwoke \n07032360332\n\nSIS Joy CHISA\n07053576543\n\nSIS Julianna Nnabuife \n07065938725\n\nSIS Adaeze Patric \n08065622779\n\nSIS Elizabeth Enne\n08037410314\n\nSIS Evelyn John \n07089946471\n\nSIS Amaka \n07033386402\n\nMummy Adebayo \n08052160814\n\nMummy withrey \n0808997362\n\nSIS Tina\n08066768446\n\nSIS blessing back of the church \n08159471212\n\nMama OMOSAYE Walne\n\nSIS Gress Akere\n08161876028\n\nSIS blessing emefel \n07066179143\n\nSIS Patricia\n08028658904\n\nSIS Rita Obi\n09122030048\n\nSIS Joy Grace compound \n08033203778\n\nPlease let call them and know why they are not in Sunday service today,";
const packed=multiline.replace(/\s+/g,' ');
const expect=(condition,message)=>{if(!condition)throw new Error(message)};
for(const[label,input]of[['multiline',multiline],['packed',packed]]){
 const result=parsePeopleRoster(input);
 const intent=inferPeopleRosterIntent(input);
 const names=result.rows.map(x=>x.name);
 expect(result.rows.length===19,label+': the supplied contact list should yield all 19 person rows.');
 expect(intent.match,label+': the message should be recognized as a People roster task.');
 expect(names.includes('Mummy Christiana'),label+': Christiana row missing.');
 expect(names.includes('SIS Sandra Isiocha'),label+': Sandra row missing.');
 expect(names.includes('Mama OMOSAYE Walne'),label+': name-only row must be retained.');
 expect(result.rows.some(x=>x.name==='Mummy Christiana'&&x.phone==='08022597401'),label+': Christiana phone missing.');
 expect(result.rows.some(x=>x.name==='SIS Sandra Isiocha'&&x.phone==='08039579758'),label+': Sandra phone missing.');
 expect(result.rows.some(x=>x.name==='Mummy withrey'&&x.phone==='0808997362'),label+': incomplete phone must remain attached for review.');
 expect(!result.rows.some(x=>Object.prototype.hasOwnProperty.call(x,'note')),label+': incidental prose must never become a roster person note.');
 expect(result.ignored.some(x=>/very strong/i.test(x)),label+': Sandra incidental prose should be ignored.');
 expect(result.ignored.some(x=>/Please let call them/i.test(x)),label+': trailing action prose should be ignored.');
}
console.log('[ARIA PEOPLE REGRESSION]');
console.log('PASS: multiline and packed natural-language rosters resolve to the same 19 People rows; incidental prose is ignored.');
