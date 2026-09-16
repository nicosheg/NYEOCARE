// lib/scanStatusToken.js
import crypto from'crypto';
const secret=()=>process.env.SCAN_STATUS_SECRET||process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.DATABASE_URL||'';
const enc=v=>Buffer.from(v).toString('base64url');
const dec=v=>Buffer.from(v,'base64url').toString('utf8');
export function createScanStatusToken(jobId,organizationId){const s=secret();if(!s)throw Error('SCAN_STATUS_SECRET_MISSING');const p=enc(JSON.stringify({j:jobId,o:organizationId,e:Date.now()+86400000}));const h=crypto.createHmac('sha256',s).update(p).digest('base64url');return`${p}.${h}`}
export function verifyScanStatusToken(token,jobId){try{const s=secret(),[p,h]=String(token||'').split('.');if(!s||!p||!h)return null;const expected=crypto.createHmac('sha256',s).update(p).digest('base64url');if(h.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(h),Buffer.from(expected)))return null;const x=JSON.parse(dec(p));if(x.j!==jobId||!x.o||Number(x.e)<Date.now())return null;return{x}}catch{return null}}
