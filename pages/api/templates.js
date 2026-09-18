export default function handler(req,res){return res.status(410).json({error:'Legacy message-template endpoint disabled. Use the current ARIA care draft flow.',code:'LEGACY_TEMPLATE_ENDPOINT'});}
