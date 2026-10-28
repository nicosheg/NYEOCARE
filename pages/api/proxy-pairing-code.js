// The legacy pairing endpoint has no organization-owned phone mapping.
// Forwarding an arbitrary phone number to the shared WhatsApp bridge could expose
// another organization's pairing secret. It stays closed until pairing is rebuilt
// on an authenticated, organization-specific connection record.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Allow', 'POST');
  return res.status(410).json({
    error: 'WhatsApp pairing is disabled until an organization-specific connection is configured.',
    code: 'WHATSAPP_PAIRING_TENANT_SCOPE_REQUIRED',
  });
}
