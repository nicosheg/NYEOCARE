// pages/api/identity/review-action.js
import{withAdmin}from'../../../lib/apiHelpers';
export default withAdmin(async function handler(req,res){return res.status(410).json({error:'This identity review endpoint has been replaced by /api/review/resolve.',code:'LEGACY_REVIEW_ENDPOINT'})});
