// pages/community.js – Part 1 of 3
import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';
import Layout from '../components/Layout';
import BirthdayPicker from '../components/BirthdayPicker';

const ICONS = {
  visitor: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" strokeWidth="2"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-7 8-7s8 3 8 7" /></svg>),
  phone: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="2" width="14" height="20" rx="2" /><line x1="12" y1="18" x2="12" y2="18.01" stroke="currentColor" strokeWidth="3" /></svg>),
  calendar: (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>),
  mail: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M2 7l10 7 10-7" /></svg>),
  note: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>),
  importIcon: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>),
  check: (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>),
  trash: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>),
  prayer: (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" strokeWidth="2"><path d="M17 14V3a1 1 0 00-1-1H8a1 1 0 00-1 1v11l4 4 6-4z" /><path d="M12 22V8" /></svg>),
  heart: (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></svg>),
  smile: (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></svg>),
  sick: (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" strokeWidth="2"><path d="M4 4h16v16H4z" /><line x1="8" y1="8" x2="16" y2="16" /><line x1="16" y1="8" x2="8" y2="16" /></svg>),
  family: (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" strokeWidth="2"><circle cx="12" cy="8" r="4" /><path d="M2 20c0-4 4-7 10-7 1.5 0 3 .3 4.3.9" /><circle cx="20" cy="18" r="3" /><path d="M20 15v2" /></svg>),
  work: (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" strokeWidth="2"><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>),
  other: (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>),
};

const isSuspicious = n => n && (n.length > 60 || [/\*\*/, /->/, /Line \d+/, /Let's/, /re-read/, /carefully/, /illegible/, /faint/, /<think>/, /the user wants/, /analyze the image/, /I will/, /^[0-9]+\./, /^[*\-]/].some(p => p.test(n)));
const getNextBirthday = b => b ? Math.ceil((new Date(new Date(b).setFullYear(new Date().getFullYear())) - new Date()) / (1000*60*60*24)) : null;

const statusColor = (s) => {
  if (s === 'alive') return '#8FB7FF';
  if (s === 'needs_decision') return '#D4AF37';
  if (s === 'conflict') return 'linear-gradient(135deg, #8FB7FF 50%, #D4AF37 50%)';
  return 'rgba(255,255,255,0.4)';
};

const statusLabel = (s) => {
  if (s === 'alive') return 'Stable Truth';
  if (s === 'needs_decision') return 'Needs Evidence';
  if (s === 'conflict') return 'Human Review Required';
  return '';
};

const statusExplanation = (status, confidence) => {
  if (status === 'alive') return `ARIA is highly confident this identity is correct. (Confidence: ${confidence || 90}%)`;
  if (status === 'needs_decision') return 'ARIA needs more evidence before confirming this identity.';
  if (status === 'conflict') return 'ARIA found multiple possible identities and requires human review.';
  return null;
};

function LoadingSkeleton() {
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px' }}>
      <div style={{ height: 36, width: '30%', borderRadius: 8, marginBottom: 25, background: 'rgba(255,255,255,0.04)' }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 20 }}>
        {[...Array(6)].map((_, i) => (
          <div key={i} className="fiducia-card shimmer" style={{ padding: 24, height: 180 }} />
        ))}
      </div>
    </div>
  );
  }
// pages/community.js – Part 2 of 3
export default function CommunityPage() {
  const [people, setPeople] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [showLivingTruthOnly, setShowLivingTruthOnly] = useState(false);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ full_name: '', phone: '', type: 'visitor', birthday: '' });
  const [selected, setSelected] = useState(null);
  const [addingNote, setAddingNote] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [importingConv, setImportingConv] = useState(false);
  const [convText, setConvText] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [pickerTarget, setPickerTarget] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editBirthday, setEditBirthday] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const timer = useRef(null);
  const [reviewItems, setReviewItems] = useState([]);
  const [showReviewPanel, setShowReviewPanel] = useState(false);
  const [scanJobId, setScanJobId] = useState(null);

  // Get session and token for authenticated requests
  const [accessToken, setAccessToken] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setAccessToken(session.access_token);
        fetchPeople(session.access_token);
        initAria(session.access_token);
      } else {
        setLoading(false);
      }
    });
  }, []);

  const fetchPeople = async (token) => {
    const res = await fetch('/api/people', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await res.json();
    if (Array.isArray(data)) { setPeople(data); setLoading(false); }
  };

  const initAria = async (token) => {
    try {
      await fetch('/api/aria/initialize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
    } catch (err) {
      console.warn('Baseline initialization failed:', err);
    }
  };

  const computeReviewItems = (peopleList) => {
    const items = [];
    peopleList.forEach(p => {
      if (p.living_truth) {
        const status = p.living_truth.status;
        if (status === 'needs_decision' || status === 'conflict') {
          items.push({
            person_id: p.id,
            extracted_name: p.first_name,
            extracted_phone: p.phone,
            status: status,
            confidence: p.living_truth.confidence || 70,
            candidates: p.living_truth.candidate_ids || [],
            resolved: false,
          });
        }
      }
    });
    return items;
  };

  // Update review items whenever people changes
  useEffect(() => {
    if (people.length > 0) {
      const items = computeReviewItems(people);
      setReviewItems(items);
    }
  }, [people]);

  useEffect(() => {
    let r = [...people];
    if (roleFilter !== 'all') r = r.filter(p => p.type === roleFilter);
    if (showLivingTruthOnly) {
      r = r.filter(p => p.living_truth && (p.living_truth.status === 'needs_decision' || p.living_truth.status === 'conflict'));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(p => (p.first_name || '').toLowerCase().includes(q) || (p.phone || '').includes(q));
    }
    setFiltered(r);
  }, [people, search, roleFilter, showLivingTruthOnly]);

  const onPointerDown = useCallback((id) => {
    timer.current = setTimeout(() => { setSelectMode(true); setSelectedIds(prev => new Set(prev).add(id)); if (navigator.vibrate) navigator.vibrate(50); }, 1200);
  }, []);
  const onPointerUp = useCallback(() => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } }, []);
  const onPointerLeave = onPointerUp;
  const toggleSelection = (id) => { if (!selectMode) return; setSelectedIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; }); };
  const selectAll = () => setSelectedIds(new Set(filtered.map(p => p.id)));
  const cancelSelect = () => { setSelectMode(false); setSelectedIds(new Set()); };

  const addPerson = async (e) => {
    e.preventDefault();
    if (!form.full_name.trim() || !accessToken) return;
    try {
      const res = await fetch('/api/people', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          first_name: form.full_name.trim(),
          phone: form.phone,
          type: form.type,
          birthday: form.birthday || null,
        }),
      });
      const data = await res.json();
      if (res.ok && data.id) {
        setPeople(prev => [data, ...prev]);
        setForm({ full_name: '', phone: '', type: 'visitor', birthday: '' });
        setShowAdd(false);
        setMsg('Person added');
        setTimeout(() => setMsg(''), 3000);
      } else {
        setMsg('Error: ' + (data.error || 'Could not add'));
        setTimeout(() => setMsg(''), 3000);
      }
    } catch (err) { setMsg('Error adding.'); setTimeout(() => setMsg(''), 3000); }
  };

  const saveEdit = async (id) => {
    if (!editName.trim() || !accessToken) return;
    try {
      const res = await fetch('/api/people', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          id,
          first_name: editName.trim(),
          phone: editPhone,
          type: people.find(p => p.id === id)?.type || 'visitor',
          birthday: editBirthday || null,
        }),
      });
      const data = await res.json();
      if (res.ok && data.id) {
        setPeople(prev => prev.map(p => p.id === id ? data : p));
        setMsg('Updated');
        setTimeout(() => setMsg(''), 3000);
        setEditingId(null);
        cancelSelect();
      } else {
        setMsg('Error: ' + (data.error || 'Update failed'));
        setTimeout(() => setMsg(''), 3000);
      }
    } catch (err) { setMsg('Error updating.'); setTimeout(() => setMsg(''), 3000); }
  };

  const deletePerson = async (id, e) => {
    if (e) e.stopPropagation();
    if (!confirm('Remove this person?') || !accessToken) return;
    try {
      const res = await fetch('/api/people/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.deleted > 0) {
        setPeople(prev => prev.filter(p => !data.deleted_ids.includes(p.id)));
        setMsg(`Deleted ${data.deleted} person.`);
        setTimeout(() => setMsg(''), 3000);
      } else {
        setMsg('Error: ' + (data.error || 'Delete failed'));
        setTimeout(() => setMsg(''), 3000);
      }
    } catch (err) { setMsg('Error deleting.'); setTimeout(() => setMsg(''), 3000); }
  };

  const bulkDelete = async () => {
    if (selectedIds.size === 0 || !accessToken) return;
    if (!confirm(`Remove ${selectedIds.size} selected people?`)) return;
    const ids = Array.from(selectedIds);
    try {
      const res = await fetch('/api/people/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.deleted > 0) {
        setPeople(prev => prev.filter(p => !data.deleted_ids.includes(p.id)));
        const notFoundMsg = data.not_found_ids.length > 0 ? ` ${data.not_found_ids.length} not found.` : '';
        setMsg(`Deleted ${data.deleted} people.${notFoundMsg}`);
        setTimeout(() => setMsg(''), 3000);
      } else {
        setMsg('Error: ' + (data.error || 'Delete failed'));
        setTimeout(() => setMsg(''), 3000);
      }
    } catch (err) { setMsg('Error deleting.'); setTimeout(() => setMsg(''), 3000); }
    cancelSelect();
  };

  const generateDraft = async (id) => {
    if (!accessToken) return;
    const res = await fetch('/api/presence/draft', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ person_id: id }),
    });
    const data = await res.json();
    if (data.message) {
      if (confirm(data.message + '\n\nOpen WhatsApp to send?')) {
        const person = people.find(p => p.id === id);
        if (person && person.phone) {
          const phone = person.phone.startsWith('+') ? person.phone.substring(1) : person.phone;
          window.open(`https://wa.me/${phone}?text=${encodeURIComponent(data.message)}`, '_blank');
          await fetch('/api/timeline', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              person_id: id,
              event_type: 'message_sent',
              channel: 'whatsapp',
              description: data.message.substring(0, 100),
              metadata: { type: 'manual_send' },
            }),
          });
          setMsg('Message opened in WhatsApp'); setTimeout(() => setMsg(''), 3000);
        }
      }
    } else { setMsg('Error: ' + (data.error || 'Draft failed')); setTimeout(() => setMsg(''), 3000); }
  };

  const saveNote = async () => {
    if (!noteText.trim() || !accessToken) return;
    await fetch('/api/timeline', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        person_id: selected.id,
        event_type: 'note',
        channel: 'manual',
        description: noteText.trim(),
        metadata: { type: 'pastoral_note' },
      }),
    });
    setNoteText(''); setAddingNote(false); setMsg('Note saved'); setTimeout(() => setMsg(''), 3000);
  };

  const importConversation = async () => {
    if (!convText.trim() || !accessToken) return;
    const res = await fetch('/api/conversation/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ person_id: selected.id, text: convText.trim() }),
    });
    const data = await res.json();
    if (data.success) { setConvText(''); setImportingConv(false); setMsg(`Conversation imported – ${data.extracted} key events extracted`); }
    else { setMsg('Error: ' + (data.error || 'Import failed')); }
    setTimeout(() => setMsg(''), 3000);
  };

  const resolveReview = async (item, action, targetId = null) => {
    if (!accessToken) return;
    try {
      const res = await fetch('/api/identity/resolve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          scan_job_id: null,
          extracted_name: item.extracted_name,
          action,
          target_person_id: targetId,
        }),
      });
      if (res.ok) {
        fetchPeople(accessToken);
        setMsg('Resolved successfully.');
        setTimeout(() => setMsg(''), 3000);
      } else {
        const err = await res.json();
        setMsg('Error: ' + err.error);
        setTimeout(() => setMsg(''), 3000);
      }
    } catch (err) {
      setMsg('Error resolving.');
      setTimeout(() => setMsg(''), 3000);
    }
  };

  const stopProp = (e) => e.stopPropagation();

  // The JSX (Part 3) uses the same state and functions defined here.
// pages/community.js – Part 3 of 3
  if (loading) {
    return (
      <Layout>
        <LoadingSkeleton />
      </Layout>
    );
  }

  const reviewStats = (() => {
    const total = reviewItems.length;
    const alive = people.filter(p => p.living_truth && p.living_truth.status === 'alive').length;
    const needs_decision = reviewItems.filter(i => i.status === 'needs_decision').length;
    const conflict = reviewItems.filter(i => i.status === 'conflict').length;
    return { total, alive, needs_decision, conflict };
  })();

  return (
    <Layout>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px' }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, color: '#f0f0f0', marginBottom: 25 }}>{people.length} lives remembered</h1>

        {/* Living Truth Banner */}
        <div style={{ marginBottom: 20 }}>
          {reviewStats.total === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'rgba(255,255,255,0.3)' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
              <span style={{ fontSize: 14 }}>Living Truth · Everything is settled</span>
            </div>
          ) : (
            <div className="living-truth-banner" onClick={() => setShowReviewPanel(true)} style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', padding: '8px 0', borderBottom: '1px solid rgba(143,183,255,0.1)' }}>
              <div className="living-dot" style={{ width: 8, height: 8, borderRadius: '50%', background: '#8FB7FF', animation: 'pulse 4s ease-in-out infinite' }} />
              <span style={{ color: '#8FB7FF', fontWeight: 500 }}>Living Truth · {reviewStats.total} identities need attention</span>
              <span style={{ marginLeft: 'auto', color: 'rgba(255,255,255,0.3)', fontSize: '0.8rem' }}>
                {reviewStats.needs_decision > 0 && `${reviewStats.needs_decision} need decision `}
                {reviewStats.conflict > 0 && `${reviewStats.conflict} conflict`}
              </span>
            </div>
          )}
        </div>

        {/* Review Panel */}
        {showReviewPanel && (
          <div className="review-panel-overlay" onClick={() => setShowReviewPanel(false)}>
            <div className="review-panel" onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}><h3 style={{ color: '#f0f0f0', margin: 0 }}>Review Needed</h3><button onClick={() => setShowReviewPanel(false)} className="fiducia-button fiducia-button-ghost">Close</button></div>
              {reviewItems.length === 0 ? <p style={{ color: 'rgba(255,255,255,0.5)' }}>No unresolved identities.</p> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {reviewItems.map(item => (
                    <div key={item.extracted_name} className="review-item" style={{ padding: '12px 16px', background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ color: '#f0f0f0', fontWeight: 500 }}>{item.extracted_name}</span>
                        {item.extracted_phone && <span style={{ color: 'rgba(255,255,255,0.4)', marginLeft: 8 }}>{item.extracted_phone}</span>}
                        <span style={{ marginLeft: 12, fontSize: '0.8rem', color: statusColor(item.status) }}>{statusLabel(item.status)}</span>
                      </div>
                      <div>
                        {item.candidates && item.candidates.length > 0 && (
                          <button className="fiducia-button fiducia-button-primary" style={{ padding: '4px 12px', fontSize: '0.8rem' }} onClick={() => resolveReview(item, 'confirm', item.candidates[0])}>Confirm</button>
                        )}
                        <button className="fiducia-button fiducia-button-secondary" style={{ padding: '4px 12px', fontSize: '0.8rem', marginLeft: 8 }} onClick={() => resolveReview(item, 'keep_new')}>Keep as New</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Controls */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="text" placeholder="Search by name or phone" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, minWidth: 200, padding: '10px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(20,25,40,0.8)', color: '#fff', outline: 'none' }} />
          <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} style={{ padding: '10px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(20,25,40,0.8)', color: '#fff', outline: 'none', width: 120 }}>
            <option value="all">All</option><option value="visitor">Visitor</option><option value="member">Member</option>
          </select>
          <button
            className={`fiducia-button ${showLivingTruthOnly ? 'fiducia-button-primary' : 'fiducia-button-ghost'}`}
            style={{ padding: '6px 12px', fontSize: '0.8rem' }}
            onClick={() => setShowLivingTruthOnly(!showLivingTruthOnly)}
          >
            {showLivingTruthOnly ? 'All' : 'Living Truth'}
          </button>
          <button onClick={() => setShowAdd(!showAdd)} className="fiducia-button fiducia-button-primary">Add Person</button>
        </div>

        {showAdd && (
          <form onSubmit={addPerson} className="fiducia-card" style={{ padding: 20, marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input placeholder="Full Name" value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} required style={miniInput} />
            <input placeholder="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} style={miniInput} />
            <div style={{ marginBottom: 8 }}>
              <label style={{ display: 'block', fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}><span style={{ color: '#D4AF37', marginRight: 6 }}>●</span> Birthday <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginLeft: 6 }}>When should ARIA celebrate?</span></label>
              <button type="button" onClick={() => { setPickerTarget('add'); setShowPicker(true); }} style={{ width: '100%', padding: '12px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(20,25,40,0.6)', color: form.birthday ? '#f0f0f0' : 'rgba(255,255,255,0.3)', fontSize: 15, textAlign: 'left', cursor: 'pointer', outline: 'none' }}>
                {form.birthday ? new Date(form.birthday).toLocaleDateString() : 'Add birthday'}
              </button>
              {form.birthday && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>Next birthday in {getNextBirthday(form.birthday)} days</div>}
            </div>
            <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} style={miniInput}><option value="visitor">Visitor</option><option value="member">Member</option></select>
            <button type="submit" className="fiducia-button fiducia-button-primary">Save</button>
          </form>
        )}

        {msg && <div className="fiducia-card" style={{ padding: 10, marginBottom: 15, color: '#34D399', textAlign: 'center' }}>{msg}</div>}

        {/* People Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 20 }}>
          {filtered.map(person => {
            const truth = person.living_truth;
            const status = truth?.status || null;
            const label = statusLabel(status);
            const explanation = statusExplanation(status, truth?.confidence);

            return (
              <div key={person.id} className="fiducia-card" onPointerDown={() => onPointerDown(person.id)} onPointerUp={onPointerUp} onPointerLeave={onPointerLeave} onClick={() => { if (selectMode) toggleSelection(person.id); else if (editingId !== person.id) setSelected(selected?.id === person.id ? null : person); }} style={{ cursor: 'pointer', transition: 'all 0.2s', border: selectedIds.has(person.id) ? '1px solid #D4AF37' : undefined, background: selectedIds.has(person.id) ? 'rgba(212,175,55,0.08)' : undefined, userSelect: 'none', WebkitUserSelect: 'none', position: 'relative' }}>
                {selectMode && <div style={{ position: 'absolute', top: 10, right: 10 }}>{selectedIds.has(person.id) ? ICONS.check : <div style={{ width: 16, height: 16, borderRadius: 4, border: '1px solid rgba(255,255,255,0.3)' }} />}</div>}

                {editingId === person.id ? (
                  <div onClick={stopProp} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <input value={editName} onChange={e => setEditName(e.target.value)} style={miniInput} placeholder="Full Name" />
                    <input value={editPhone} onChange={e => setEditPhone(e.target.value)} style={miniInput} placeholder="Phone" />
                    <div style={{ marginBottom: 8 }}>
                      <label style={{ display: 'block', fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}><span style={{ color: '#D4AF37', marginRight: 6 }}>●</span> Birthday</label>
                      <button type="button" onClick={() => { setPickerTarget('edit'); setShowPicker(true); }} style={{ width: '100%', padding: '12px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(20,25,40,0.6)', color: editBirthday ? '#f0f0f0' : 'rgba(255,255,255,0.3)', fontSize: 15, textAlign: 'left', cursor: 'pointer', outline: 'none' }}>
                        {editBirthday ? new Date(editBirthday).toLocaleDateString() : 'Add birthday'}
                      </button>
                      {editBirthday && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>Next birthday in {getNextBirthday(editBirthday)} days</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={(e) => { e.stopPropagation(); saveEdit(person.id); }} className="fiducia-button fiducia-button-primary" style={{ padding: '6px 12px', fontSize: 13 }}>Save</button>
                      <button onClick={(e) => { e.stopPropagation(); setEditingId(null); cancelSelect(); }} className="fiducia-button fiducia-button-ghost" style={{ padding: '6px 12px', fontSize: 13 }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, fontSize: 17, color: '#f0f0f0' }}>{person.first_name}</span>
                        {status && (
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            fontSize: '0.7rem',
                            padding: '2px 10px 2px 6px',
                            borderRadius: 20,
                            background: `rgba(255,255,255,0.04)`,
                            border: `1px solid ${status === 'conflict' ? 'rgba(143,183,255,0.3)' : 'rgba(255,255,255,0.08)'}`,
                            fontWeight: 500,
                            color: status === 'conflict' ? '#8FB7FF' : (status === 'alive' ? '#8FB7FF' : '#D4AF37'),
                            boxShadow: `0 0 12px ${status === 'conflict' ? 'rgba(143,183,255,0.15)' : 'rgba(255,255,255,0.02)'}`,
                          }}>
                            <span style={{
                              display: 'inline-block',
                              width: 10,
                              height: 10,
                              borderRadius: '50%',
                              background: statusColor(status),
                              animation: 'pulse 2.5s ease-in-out infinite',
                              boxShadow: `0 0 12px ${status === 'conflict' ? 'rgba(143,183,255,0.4)' : 'rgba(255,255,255,0.1)'}`,
                            }} />
                            {label}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: 'rgba(212,175,55,0.15)', color: '#D4AF37', display: 'flex', alignItems: 'center', gap: 4 }}>{ICONS.visitor} {person.type || 'visitor'}</span>
                      </div>
                    </div>
                    {explanation && (
                      <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', marginBottom: 6, fontStyle: 'italic' }}>
                        {explanation}
                      </div>
                    )}
                    <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>{ICONS.phone} {person.phone || 'No phone'}</div>
                    {person.birthday && <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ color: '#D4AF37', fontSize: 10 }}>●</span> Birthday: {new Date(person.birthday).toLocaleDateString()} <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 10, marginLeft: 4 }}>(in {getNextBirthday(person.birthday)} days)</span></div>}
                    {person.last_attended_date && <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>{ICONS.calendar} Last attended: {new Date(person.last_attended_date).toLocaleDateString()}</div>}
                    {person.last_contacted ? <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>{ICONS.mail} Last contacted: {new Date(person.last_contacted).toLocaleDateString()}</div> : <div style={{ color: '#F59E0B', fontSize: 12, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>{ICONS.mail} Never contacted</div>}

                    {selected?.id === person.id && !selectMode && !editingId && (
                      <div style={{ marginTop: 15, padding: '15px 0 0', borderTop: '1px solid rgba(255,255,255,0.06)' }} onClick={stopProp}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                          <button onClick={(e) => { e.stopPropagation(); generateDraft(person.id); }} className="fiducia-button fiducia-button-primary" style={actionBtnStyle}><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{ICONS.mail} Draft & Send WhatsApp</span></button>
                          <Link href={`/person/${person.id}`} className="fiducia-button fiducia-button-secondary" style={actionBtnStyle}>Journey →</Link>
                          <button onClick={(e) => { e.stopPropagation(); setAddingNote(true); }} className="fiducia-button fiducia-button-ghost" style={actionBtnStyle}><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{ICONS.note} Add pastoral note</span></button>
                          <button onClick={(e) => { e.stopPropagation(); setImportingConv(true); }} className="fiducia-button fiducia-button-ghost" style={actionBtnStyle}><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{ICONS.importIcon} Import Conversation</span></button>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={(e) => deletePerson(person.id, e)} className="fiducia-button fiducia-button-ghost" style={actionBtnStyle}><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{ICONS.trash} Remove</span></button>
                        </div>
                      </div>
                    )}

                    {addingNote && selected?.id === person.id && (
                      <div style={{ marginTop: 12, background: 'rgba(20,25,40,0.9)', borderRadius: 12, padding: 12, border: '1px solid rgba(255,255,255,0.05)' }} onClick={stopProp}>
                        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', marginBottom: 8 }}>What happened today?</p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                          {[{ icon: ICONS.prayer, label: 'Asked for prayer' }, { icon: ICONS.heart, label: 'First-time visitor' }, { icon: ICONS.smile, label: 'Shared good news' }, { icon: ICONS.sick, label: 'Sick or recovering' }, { icon: ICONS.family, label: 'Family situation' }, { icon: ICONS.work, label: 'Work or school' }, { icon: ICONS.other, label: 'Other' }].map(prompt => (<button key={prompt.label} onClick={(e) => { e.stopPropagation(); setNoteText(prompt.label + ': '); }} style={promptBtnStyle}><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{prompt.icon} {prompt.label}</span></button>))}
                        </div>
                        <textarea value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Add more details..." rows={3} style={textareaStyle} />
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={(e) => { e.stopPropagation(); saveNote(); }} className="fiducia-button fiducia-button-primary" style={{ padding: '6px 12px', fontSize: 13 }}>Save</button>
                          <button onClick={(e) => { e.stopPropagation(); setAddingNote(false); setNoteText(''); }} className="fiducia-button fiducia-button-ghost" style={{ padding: '6px 12px', fontSize: 13 }}>Cancel</button>
                        </div>
                      </div>
                    )}

                    {importingConv && selected?.id === person.id && (
                      <div style={{ marginTop: 12, background: 'rgba(20,25,40,0.9)', borderRadius: 12, padding: 12, border: '1px solid rgba(255,255,255,0.05)' }} onClick={stopProp}>
                        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', marginBottom: 8 }}>Paste your WhatsApp, SMS, or notes conversation here.</p>
                        <textarea value={convText} onChange={e => setConvText(e.target.value)} placeholder="Paste conversation..." rows={4} style={textareaStyle} />
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={(e) => { e.stopPropagation(); importConversation(); }} className="fiducia-button fiducia-button-primary" style={{ padding: '6px 12px', fontSize: 13 }}>Parse & Save</button>
                          <button onClick={(e) => { e.stopPropagation(); setImportingConv(false); setConvText(''); }} className="fiducia-button fiducia-button-ghost" style={{ padding: '6px 12px', fontSize: 13 }}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {showPicker && (
        <BirthdayPicker isOpen={true} value={pickerTarget === 'add' ? form.birthday : editBirthday} onSave={(date) => { if (pickerTarget === 'add') { setForm({ ...form, birthday: date }); } else { setEditBirthday(date || ''); } setShowPicker(false); }} onCancel={() => setShowPicker(false)} />
      )}

      <style jsx>{`
        @keyframes pulse { 0% { opacity: 0.4; transform: scale(1); } 50% { opacity: 1; transform: scale(1.1); } 100% { opacity: 0.4; transform: scale(1); } }
        .shimmer {
          background: linear-gradient(110deg,
            rgba(255,255,255,0.02) 25%,
            rgba(255,255,255,0.05) 50%,
            rgba(255,255,255,0.02) 75%
          );
          background-size: 200% 100%;
          animation: shimmer 4s ease-in-out infinite;
        }
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        .review-panel-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(8px); z-index: 1000; display: flex; align-items: center; justify-content: center; }
        .review-panel { background: #141c2b; border-radius: 20px; padding: 24px; max-width: 700px; width: 90%; max-height: 80vh; overflow-y: auto; border: 1px solid rgba(255,255,255,0.05); }
        .fiducia-card { background: rgba(20,25,40,0.9); border-radius: 26px; border: 1px solid rgba(255,255,255,0.05); box-shadow: inset 0 0 10px rgba(212,175,55,0.03); transition: border-color 0.4s ease, box-shadow 0.4s ease, transform 0.2s ease; padding: 24px; margin-bottom: 18px; animation: cardBreathe 20s ease-in-out infinite alternate; }
        @keyframes cardBreathe { 0% { box-shadow: inset 0 0 10px rgba(212,175,55,0.03); } 100% { box-shadow: inset 0 0 14px rgba(212,175,55,0.06); } }
        .fiducia-button { padding: 12px 24px; border-radius: 30px; font-weight: 500; font-size: 15px; cursor: pointer; transition: background 0.2s, box-shadow 0.2s, transform 0.1s; display: inline-block; text-decoration: none; text-align: center; user-select: none; border: 1px solid transparent; }
        .fiducia-button-primary { background: rgba(212,175,55,0.1); border-color: rgba(212,175,55,0.2); color: #D4AF37; }
        .fiducia-button-primary:active { background: rgba(212,175,55,0.2); box-shadow: 0 0 18px rgba(212,175,55,0.12); transform: scale(0.98); }
        .fiducia-button-secondary { background: rgba(59,130,246,0.1); border-color: rgba(59,130,246,0.2); color: #60A5FA; }
        .fiducia-button-secondary:active { background: rgba(59,130,246,0.2); box-shadow: 0 0 18px rgba(59,130,246,0.12); transform: scale(0.98); }
        .fiducia-button-ghost { background: transparent; border-color: rgba(255,255,255,0.1); color: rgba(255,255,255,0.6); }
        .fiducia-button-ghost:active { background: rgba(255,255,255,0.05); box-shadow: 0 0 10px rgba(255,255,255,0.05); transform: scale(0.98); }
        .fiducia-card:active { border-color: rgba(212,175,55,0.25); box-shadow: inset 0 0 15px rgba(212,175,55,0.08); transform: scale(0.99); }
      `}</style>
    </Layout>
  );
}

const miniInput = { padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(20,25,40,0.6)', color: '#fff', outline: 'none' };
const textareaStyle = { width: '100%', padding: 8, borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.03)', color: '#fff', resize: 'vertical', outline: 'none', marginBottom: 8 };
const actionBtnStyle = { padding: '6px 12px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 };
const promptBtnStyle = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#D4AF37', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' };
const selectBar = { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: 'rgba(10,15,26,0.9)', backdropFilter: 'blur(20px)', borderRadius: 20, padding: '12px 24px', display: 'flex', gap: 16, zIndex: 1001, border: '1px solid rgba(255,255,255,0.06)' };
const barBtn = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff', borderRadius: 10, padding: '8px 16px', fontSize: 13, cursor: 'pointer', backdropFilter: 'blur(10px)' };
