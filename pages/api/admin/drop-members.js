// Retired: this endpoint previously dropped the members table without auth.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(404).json({ error: 'Not found' });
}
