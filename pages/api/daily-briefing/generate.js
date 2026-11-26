// Retired compatibility endpoint. ARIA Today is derived live from the canonical Home bootstrap.
import {withAdmin} from '../../../lib/apiHelpers';

export default withAdmin(async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 res.setHeader('Cache-Control','no-store');
 return res.status(410).json({
  error:'Persisted daily briefing snapshots are retired. Use the live ARIA Today workspace.',
  code:'LEGACY_DAILY_BRIEFING_RETIRED',
  canonical_endpoint:'/api/home/bootstrap'
 });
});
