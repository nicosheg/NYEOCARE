// pages/attendance.js
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../components/Layout';
import ClientErrorBoundary from '../components/ClientErrorBoundary';
import AttendanceModal from '../components/AttendanceModal';

function AttendancePageLoading() {
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, color: 'var(--ny-text-muted)' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 30, height: 30, margin: '0 auto 12px', borderRadius: '50%', border: '2px solid rgba(214,184,106,.2)', borderTopColor: '#D6B86A', animation: 'attendanceRouteSpin .8s linear infinite' }} />
        <p style={{ margin: 0, fontSize: 13 }}>Opening Attendance…</p>
        <style jsx>{`@keyframes attendanceRouteSpin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </main>
  );
}

function AttendanceRecovery({ onClose }) {
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, color: 'var(--ny-text)' }}>
      <section style={{ width: 'min(440px,100%)', padding: 26, border: '1px solid var(--ny-border)', borderRadius: 22, background: 'var(--ny-surface)', textAlign: 'center' }}>
        <div style={{ fontSize: 10, letterSpacing: 3, color: 'var(--ny-text-whisper)', marginBottom: 12 }}>NYEOCARE</div>
        <h1 style={{ margin: '0 0 10px', fontSize: 22 }}>Attendance needs to be reopened.</h1>
        <p style={{ margin: '0 0 20px', color: 'var(--ny-text-muted)', fontSize: 14, lineHeight: 1.6 }}>Your saved attendance data is protected. Return home and open Attendance again.</p>
        <button type="button" onClick={onClose} style={{ padding: '11px 18px', border: 0, borderRadius: 999, background: 'var(--ny-text)', color: 'var(--ny-bg)', fontWeight: 700, cursor: 'pointer' }}>Back to NYEOCARE</button>
      </section>
    </main>
  );
}

export default function AttendancePage() {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const goHome = () => router.replace('/');

  useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <Layout>
      <ClientErrorBoundary surface="attendance-page" resetKey={router.asPath} fallback={<AttendanceRecovery onClose={goHome} />}>
        {hydrated
          ? <AttendanceModal isOpen={true} onClose={goHome} />
          : <AttendancePageLoading />}
      </ClientErrorBoundary>
    </Layout>
  );
}
