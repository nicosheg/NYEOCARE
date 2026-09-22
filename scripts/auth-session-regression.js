// scripts/auth-session-regression.js
import fs from'node:fs';

const read=p=>fs.readFileSync(p,'utf8');
const session=read('lib/clientSession.js');
const app=read('pages/_app.js');
const onboarding=read('components/OnboardingProvider.js');
const login=read('pages/login.js');
const profile=read('pages/profile.js');

const must=(text,needle,label)=>{
 if(!text.includes(needle))throw new Error('Auth regression: missing '+label);
};

must(session,'refreshClientSession','refresh recovery');
must(session,'READ_RETRY_MS','session read retry');
must(session,'onAuthStateChange','auth listener');
must(session,"event==='SIGNED_OUT'","explicit sign-out clearing');
must(session,'inFlight','serialized session reads');
must(app,'AuthSessionKeeper','global session keeper');
must(onboarding,"event==='SIGNED_OUT'","onboarding only resets on explicit sign-out");
if(onboarding.includes("event==='SIGNED_OUT'||!session"))throw new Error('Auth regression: onboarding still treats a transient null session as sign-out.');
if(login.includes("signOut({scope:'local'})"))throw new Error('Auth regression: login may not sign out while validating an existing session.');
must(login,'refreshClientSession','login refresh recovery');
must(profile,'refreshClientSession','profile 401 recovery');

console.log('Auth session regression checks passed.');
