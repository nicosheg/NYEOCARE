// This legacy endpoint performed cross-table mutations and dropped tables
// without authentication. Maintenance tasks must use reviewed migrations.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(404).json({ error: 'Not found' });
}
