// This legacy endpoint used a client-supplied church_id and sent a hard-coded
// bulk message to every matching row. Keep it fail-closed until bulk messaging
// is rebuilt on the tenant-scoped, consent-aware communication workflow.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Allow', 'POST');
  return res.status(410).json({
    error: 'This legacy bulk messaging endpoint is retired. Use NYEOCARE communication workflows.',
    code: 'LEGACY_BULK_MESSAGING_RETIRED',
  });
}
