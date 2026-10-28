import Layout from '../components/Layout';

export default function LinkWhatsApp() {
  return (
    <Layout>
      <div style={{ maxWidth: 560, margin: '40px auto', padding: '0 20px', color: '#f0f0f0' }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 16 }}>Link WhatsApp</h1>
        <p style={{ color: 'rgba(255,255,255,0.78)', lineHeight: 1.7 }}>
          WhatsApp pairing is temporarily unavailable. The previous flow accepted any phone
          number and used a shared bridge without proving which organization owned that
          connection. NYEOCARE will not request or reveal a pairing code until the connection
          is configured and authorized for your organization.
        </p>
      </div>
    </Layout>
  );
}
