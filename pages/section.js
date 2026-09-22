// pages/section.js
// Organization-scoped section attendance.
// People come from the canonical people/attendance API.

import { useRouter } from 'next/router';
import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import { supabase } from '../lib/supabaseClient';

export default function SectionCheckin() {
  const router = useRouter();
  const { sessionId, section } = router.query;

  const [people, setPeople] = useState([]);
  const [search, setSearch] = useState('');
  const [presentIds, setPresentIds] = useState(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPerson, setNewPerson] = useState({
    first_name: '',
    last_name: '',
    phone: '',
    type: 'visitor',
  });
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const getSession = async () => {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      router.replace('/login');
      return null;
    }

    return session;
  };

  // Load active people belonging to the authenticated organization.
  const loadPeople = useCallback(async () => {
    if (!sessionId || !section) return;

    setLoading(true);
    setError('');

    try {
      const session = await getSession();
      if (!session) return;

      const query = search.trim()
        ? `?q=${encodeURIComponent(search.trim())}`
        : '';

      const res = await fetch(`/api/attendance/search${query}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Could not load people.');
      }

      setPeople(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Load attendance people error:', err);
      setError(err.message || 'Could not load people.');
    } finally {
      setLoading(false);
    }
  }, [sessionId, section, search]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadPeople();
    }, 200);

    return () => clearTimeout(timer);
  }, [loadPeople]);

  const togglePresent = id => {
    setPresentIds(prev => {
      const next = new Set(prev);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  };

  // Submit only the people explicitly marked present.
  const submitSection = async () => {
    if (submitted) return;

    try {
      const session = await getSession();
      if (!session) return;

      const res = await fetch('/api/attendance/section-checkin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          session_id: sessionId,
          section_name: section,
          present_ids: [...presentIds],
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Could not submit attendance.');
      }

      setSubmitted(true);
    } catch (err) {
      console.error('Submit attendance error:', err);
      alert(err.message || 'Could not submit attendance.');
    }
  };

  // Create a new person in the current organization, then mark them present.
  const handleAddPerson = async e => {
    e.preventDefault();

    if (!newPerson.first_name.trim()) return;

    setAdding(true);

    try {
      const session = await getSession();
      if (!session) return;

      const addRes = await fetch('/api/people', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          first_name: newPerson.first_name.trim(),
          last_name: newPerson.last_name.trim(),
          phone: newPerson.phone.trim(),
          type: newPerson.type,
        }),
      });

      const person = await addRes.json();

      if (!addRes.ok || !person.id) {
        throw new Error(person.error || 'Could not add person.');
      }

      // Immediately mark the newly created person present.
      const attendanceRes = await fetch(
        '/api/attendance/section-checkin',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            session_id: sessionId,
            section_name: section,
            present_ids: [person.id],
          }),
        }
      );

      const attendanceData = await attendanceRes.json();

      if (!attendanceRes.ok || !attendanceData.success) {
        throw new Error(
          attendanceData.error ||
          'Person was added but attendance could not be recorded.'
        );
      }

      setPeople(prev => [person, ...prev]);
      setPresentIds(prev => new Set(prev).add(person.id));

      setNewPerson({
        first_name: '',
        last_name: '',
        phone: '',
        type: 'visitor',
      });

      setShowAddForm(false);
    } catch (err) {
      console.error('Add person error:', err);
      alert(err.message || 'Could not add person.');
    } finally {
      setAdding(false);
    }
  };

  return (
    <Layout>
      <div style={{ maxWidth: 600, margin: '0 auto', padding: 20 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700 }}>
          Section: {section}
        </h2>

        <p style={{ color: '#666' }}>
          Tap a name to mark present
        </p>

        <input
          type="text"
          placeholder="🔍 Search people"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%',
            padding: 12,
            marginBottom: 15,
            borderRadius: 12,
            border: '1px solid #ddd',
            background: 'rgba(255,255,255,0.8)',
            backdropFilter: 'blur(5px)',
          }}
        />

        <button
          onClick={() => setShowAddForm(prev => !prev)}
          style={{
            marginBottom: 15,
            background: '#ff9800',
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            padding: '10px 20px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {showAddForm ? '✕ Cancel' : '➕ Add Person'}
        </button>

        {showAddForm && (
          <form
            onSubmit={handleAddPerson}
            style={{
              marginBottom: 20,
              background: 'rgba(255,255,255,0.8)',
              backdropFilter: 'blur(10px)',
              padding: 15,
              borderRadius: 12,
              boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            }}
          >
            <input
              placeholder="First Name *"
              value={newPerson.first_name}
              onChange={e =>
                setNewPerson({
                  ...newPerson,
                  first_name: e.target.value,
                })
              }
              style={miniInput}
              required
            />

            <input
              placeholder="Last Name"
              value={newPerson.last_name}
              onChange={e =>
                setNewPerson({
                  ...newPerson,
                  last_name: e.target.value,
                })
              }
              style={miniInput}
            />

            <input
              placeholder="Phone"
              value={newPerson.phone}
              onChange={e =>
                setNewPerson({
                  ...newPerson,
                  phone: e.target.value,
                })
              }
              style={miniInput}
            />

            <select
              value={newPerson.type}
              onChange={e =>
                setNewPerson({
                  ...newPerson,
                  type: e.target.value,
                })
              }
              style={miniInput}
            >
              <option value="visitor">Visitor</option>
              <option value="new">New Person</option>
              <option value="member">Member</option>
            </select>

            <button
              type="submit"
              disabled={adding}
              style={{
                background: '#4F46E5',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '8px 16px',
                cursor: adding ? 'default' : 'pointer',
              }}
            >
              {adding ? 'Adding...' : 'Add & Mark Present'}
            </button>
          </form>
        )}

        {error && (
          <div
            style={{
              padding: 12,
              marginBottom: 15,
              borderRadius: 10,
              background: '#ffebee',
              color: '#c62828',
            }}
          >
            {error}
          </div>
        )}

        {!loading && !error && people.length === 0 && (
          <div
            style={{
              padding: 20,
              textAlign: 'center',
              color: '#666',
              background: 'rgba(255,255,255,0.7)',
              borderRadius: 12,
            }}
          >
            No people found.
          </div>
        )}

        {loading ? (
          <p style={{ textAlign: 'center', color: '#666' }}>
            Loading people...
          </p>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {people.map(person => (
              <div
                key={person.id}
                onClick={() => togglePresent(person.id)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: 14,
                  borderRadius: 12,
                  background: presentIds.has(person.id)
                    ? '#e8f5e9'
                    : 'rgba(255,255,255,0.8)',
                  border: presentIds.has(person.id)
                    ? '2px solid #4CAF50'
                    : '1px solid rgba(255,255,255,0.3)',
                  backdropFilter: 'blur(5px)',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                <span>
                  {person.first_name} {person.last_name || ''}
                  {person.type && person.type !== 'member'
                    ? ` (${person.type})`
                    : ''}
                </span>

                <span style={{ fontSize: 24 }}>
                  {presentIds.has(person.id) ? '✅' : '⬜'}
                </span>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={submitSection}
          disabled={submitted || loading}
          style={{
            width: '100%',
            marginTop: 25,
            padding: 14,
            background: submitted
              ? '#aaa'
              : 'linear-gradient(135deg, #4CAF50, #2E7D32)',
            color: '#fff',
            border: 'none',
            borderRadius: 14,
            fontSize: 18,
            fontWeight: 600,
            cursor: submitted || loading ? 'default' : 'pointer',
            boxShadow: submitted
              ? 'none'
              : '0 4px 12px rgba(76,175,80,0.3)',
          }}
        >
          {submitted
            ? '✅ Submitted'
            : `Submit Section Attendance (${presentIds.size})`}
        </button>
      </div>
    </Layout>
  );
}

const miniInput = {
  width: '100%',
  padding: 10,
  marginBottom: 8,
  borderRadius: 8,
  border: '1px solid #ddd',
  background: 'rgba(255,255,255,0.9)',
};
