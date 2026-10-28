// Database migrations are deployed through the controlled migration pipeline.
// This legacy endpoint performed DDL and cross-table mutations without auth.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(404).json({ error: 'Not found' });
}
