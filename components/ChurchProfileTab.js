// components/ChurchProfileTab.js
// Legacy filename retained for compatibility.
// User-facing concept: Organization Profile.
// This component also stores ARIA's editable organization-level guidance.

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { DEFAULT_FOLLOW_UP_POLICY } from '../lib/aria/followUpPolicy';

const policySelect = {
  width: '100%',
  minHeight: 42,
  padding: '9px 11px',
  borderRadius: 9,
  border: '1px solid rgba(255,255,255,.11)',
  background: '#101b2b',
  color: '#f0f0f0',
  outline: 'none',
  fontSize: 13,
};

export default function ChurchProfileTab() {
  const [services, setServices] = useState([
    { day: 'Sunday', time: '09:00' },
  ]);
  const [programs, setPrograms] = useState([{ name: '' }]);
  const [ariaInstructions, setAriaInstructions] = useState('');
  const [saved, setSaved] = useState(false);
  const [ariaSaved, setAriaSaved] = useState(false);
  const [followUpPolicy, setFollowUpPolicy] = useState({ ...DEFAULT_FOLLOW_UP_POLICY });
  const [followUpPolicySaving, setFollowUpPolicySaving] = useState(false);
  const [followUpPolicySaved, setFollowUpPolicySaved] = useState(false);
  const [followUpPolicyError, setFollowUpPolicyError] = useState('');

  useEffect(() => {
    async function fetchProfile() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) return;

      try {
        const headers = {
          Authorization: `Bearer ${session.access_token}`,
        };

        const [profileRes, onboardingRes] = await Promise.all([
          fetch('/api/church-profile', { headers }),
          fetch('/api/onboarding', { headers }),
        ]);

        if (profileRes.ok) {
          const data = await profileRes.json();

          if (data.services) setServices(data.services);
          if (data.programs) setPrograms(data.programs);
        }

        if (onboardingRes.ok) {
          const data = await onboardingRes.json();
          setAriaInstructions(data.ariaInstructions || '');
          setFollowUpPolicy({ ...DEFAULT_FOLLOW_UP_POLICY, ...(data.followUpPolicy || {}) });
        }
      } catch (error) {
        console.error('[PROFILE] Load error:', error);
      }
    }

    fetchProfile();
  }, []);

  const saveProfile = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) return;

    try {
      const response = await fetch('/api/church-profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          services: services.filter(s => s.day),
          programs: programs.filter(p => p.name),
        }),
      });

      if (!response.ok) {
        throw new Error('Unable to save organization profile');
      }

      setSaved(true);

      setTimeout(() => {
        setSaved(false);
      }, 2000);
    } catch (error) {
      console.error('[PROFILE] Save error:', error);
    }
  };

  const saveAriaInstructions = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) return;

    try {
      const response = await fetch('/api/onboarding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: 'save_aria_instructions',
          ariaInstructions,
        }),
      });

      if (!response.ok) {
        throw new Error('Unable to save ARIA instructions');
      }

      setAriaSaved(true);

      setTimeout(() => {
        setAriaSaved(false);
      }, 2000);
    } catch (error) {
      console.error('[ARIA] Instruction save error:', error);
    }
  };


  const saveFollowUpPolicy = async () => {
    setFollowUpPolicySaving(true);
    setFollowUpPolicyError('');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setFollowUpPolicySaving(false);
      setFollowUpPolicyError('Please sign in again to save this policy.');
      return;
    }
    try {
      const response = await fetch('/api/onboarding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + session.access_token,
        },
        body: JSON.stringify({ action: 'save_follow_up_policy', followUpPolicy }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to save follow-up policy.');
      setFollowUpPolicy({ ...DEFAULT_FOLLOW_UP_POLICY, ...(data.followUpPolicy || {}) });
      setFollowUpPolicySaved(true);
      setTimeout(() => setFollowUpPolicySaved(false), 2200);
    } catch (error) {
      setFollowUpPolicyError(error.message || 'Unable to save follow-up policy.');
    } finally {
      setFollowUpPolicySaving(false);
    }
  };

  const addService = () =>
    setServices([...services, { day: '', time: '' }]);

  const addProgram = () =>
    setPrograms([...programs, { name: '' }]);

  return (
    <div className="organization-profile-tab">
      {/* ARIA organization-level guidance */}
      <div
        className="fiducia-card"
        style={{
          padding: 24,
          marginBottom: 24,
        }}
      >
        <div
          style={{
            color: '#D4AF37',
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            marginBottom: 8,
          }}
        >
          ARIA
        </div>

        <h3
          style={{
            color: '#f0f0f0',
            margin: '0 0 8px',
            fontSize: 20,
            fontWeight: 500,
          }}
        >
          What should ARIA keep in mind?
        </h3>

        <p
          style={{
            color: 'rgba(255,255,255,.5)',
            lineHeight: 1.6,
            marginBottom: 16,
          }}
        >
          Tell ARIA something important about your organization.
          You can change this whenever you want.
        </p>

        <textarea
          value={ariaInstructions}
          onChange={e =>
            setAriaInstructions(e.target.value)
          }
          maxLength={2000}
          placeholder="For example: We care deeply about noticing people who may be quietly becoming disconnected."
          style={{
            width: '100%',
            minHeight: 120,
            resize: 'vertical',
            padding: 14,
            borderRadius: 14,
            border: '1px solid rgba(255,255,255,.08)',
            background: 'rgba(255,255,255,.03)',
            color: '#fff',
            outline: 'none',
            fontSize: 15,
            lineHeight: 1.6,
            fontFamily: 'inherit',
          }}
        />

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 12,
            gap: 12,
          }}
        >
          <span
            style={{
              color: 'rgba(255,255,255,.3)',
              fontSize: 12,
            }}
          >
            {ariaInstructions.length}/2000
          </span>

          <button
            onClick={saveAriaInstructions}
            className="fiducia-button fiducia-button-primary"
          >
            {ariaSaved ? 'Saved ✓' : 'Save for ARIA'}
          </button>
        </div>
      </div>


      {/* Follow-up policy: compulsory human accountability, paced contact. */}
      <div
        className="fiducia-card"
        style={{ padding: 24, marginBottom: 24 }}
      >
        <div style={{ color: '#D4AF37', fontSize: 11, fontWeight: 650, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 8 }}>
          CARE RHYTHM
        </div>
        <h3 style={{ color: '#f0f0f0', margin: '0 0 8px', fontSize: 20, fontWeight: 500 }}>
          Follow-up policy
        </h3>
        <p style={{ color: 'rgba(255,255,255,.56)', lineHeight: 1.6, margin: '0 0 18px', fontSize: 13 }}>
          Make a real first-visit care outcome accountable, then let ARIA pace routine outreach using recent contact and response history. These settings never send messages automatically.
        </p>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 11, color: '#f0f0f0', lineHeight: 1.5, fontSize: 14, marginBottom: 18 }}>
          <input
            type="checkbox"
            checked={followUpPolicy.firstVisitFollowUpRequired}
            onChange={e => setFollowUpPolicy(v => ({ ...v, firstVisitFollowUpRequired: e.target.checked }))}
            style={{ marginTop: 4, accentColor: '#D4AF37' }}
          />
          <span>
            <strong>Require first-visit follow-up</strong>
            <span style={{ display: 'block', color: 'rgba(255,255,255,.46)', fontSize: 12, marginTop: 3 }}>
              A visitor attendance cannot silently disappear. A worker must confirm the person’s situation and record a real outcome; “required” does not mean forcing a message.
            </span>
          </span>
        </label>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 11, color: '#f0f0f0', lineHeight: 1.5, fontSize: 14, marginBottom: 18 }}>
          <input
            type="checkbox"
            checked={followUpPolicy.attendancePatternFollowUpEnabled}
            onChange={e => setFollowUpPolicy(v => ({ ...v, attendancePatternFollowUpEnabled: e.target.checked }))}
            style={{ marginTop: 4, accentColor: '#D4AF37' }}
          />
          <span>
            <strong>Notice meaningful changes in attendance patterns</strong>
            <span style={{ display: 'block', color: 'rgba(255,255,255,.46)', fontSize: 12, marginTop: 3 }}>
              ARIA checks the same recurring service over time—not just the weekday. It only suggests a human check-in after repeated, recent participation, and respects contact cooldowns, no-response pauses and do-not-contact requests. Optional gatherings are not treated as expected attendance.
            </span>
          </span>
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(185px,1fr))', gap: 12 }}>
          <label style={{ display: 'grid', gap: 7, color: 'rgba(255,255,255,.72)', fontSize: 12 }}>
            First-touch deadline
            <select value={followUpPolicy.firstVisitDueHours} onChange={e => setFollowUpPolicy(v => ({ ...v, firstVisitDueHours: Number(e.target.value) }))} style={policySelect}>
              <option value={6}>6 hours</option><option value={12}>12 hours</option><option value={24}>24 hours</option><option value={36}>36 hours</option><option value={48}>48 hours</option><option value={72}>72 hours</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: 7, color: 'rgba(255,255,255,.72)', fontSize: 12 }}>
            Routine contact gap
            <select value={followUpPolicy.routineCooldownDays} onChange={e => setFollowUpPolicy(v => ({ ...v, routineCooldownDays: Number(e.target.value) }))} style={policySelect}>
              <option value={3}>3 days</option><option value={7}>7 days</option><option value={14}>14 days</option><option value={21}>21 days</option><option value={30}>30 days</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: 7, color: 'rgba(255,255,255,.72)', fontSize: 12 }}>
            Quiet period after no reply
            <select value={followUpPolicy.noResponseCooldownDays} onChange={e => setFollowUpPolicy(v => ({ ...v, noResponseCooldownDays: Number(e.target.value) }))} style={policySelect}>
              <option value={7}>7 days</option><option value={14}>14 days</option><option value={21}>21 days</option><option value={30}>30 days</option><option value={45}>45 days</option><option value={60}>60 days</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: 7, color: 'rgba(255,255,255,.72)', fontSize: 12 }}>
            Maximum routine contacts per person / 30 days
            <select value={followUpPolicy.maxRoutineContactsPer30Days} onChange={e => setFollowUpPolicy(v => ({ ...v, maxRoutineContactsPer30Days: Number(e.target.value) }))} style={policySelect}>
              <option value={1}>1 contact</option><option value={2}>2 contacts</option><option value={3}>3 contacts</option><option value={4}>4 contacts</option><option value={6}>6 contacts</option><option value={8}>8 contacts</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: 7, color: 'rgba(255,255,255,.72)', fontSize: 12 }}>
            Daily task capacity per worker
            <select value={followUpPolicy.workerDailyCapacity} onChange={e => setFollowUpPolicy(v => ({ ...v, workerDailyCapacity: Number(e.target.value) }))} style={policySelect}>
              <option value={1}>1 task</option><option value={3}>3 tasks</option><option value={5}>5 tasks</option><option value={8}>8 tasks</option><option value={10}>10 tasks</option><option value={15}>15 tasks</option>
            </select>
          </label>
        </div>
        {followUpPolicyError && <p style={{ color: '#fca5a5', fontSize: 12, lineHeight: 1.5, margin: '14px 0 0' }}>{followUpPolicyError}</p>}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 18 }}>
          <span style={{ color: 'rgba(255,255,255,.36)', fontSize: 11 }}>Routine outreach needs human approval. No reply means pause, not repeat immediately.</span>
          <button onClick={saveFollowUpPolicy} disabled={followUpPolicySaving} className="fiducia-button fiducia-button-primary">
            {followUpPolicySaving ? 'Saving…' : followUpPolicySaved ? 'Saved ✓' : 'Save care policy'}
          </button>
        </div>
      </div>

      {/* Organization schedule */}
      <div
        className="fiducia-card"
        style={{
          padding: 24,
          marginBottom: 20,
        }}
      >
        <h3
          style={{
            color: '#D4AF37',
            marginBottom: 16,
          }}
        >
          Schedule
        </h3>

        {services.map((s, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: 10,
              marginBottom: 10,
            }}
          >
            <input
              placeholder="Day"
              value={s.day}
              onChange={e => {
                const newServices = [...services];
                newServices[i] = {
                  ...newServices[i],
                  day: e.target.value,
                };
                setServices(newServices);
              }}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.03)',
                color: '#fff',
                outline: 'none',
                flex: 1,
              }}
            />

            <input
              placeholder="Time"
              value={s.time}
              onChange={e => {
                const newServices = [...services];
                newServices[i] = {
                  ...newServices[i],
                  time: e.target.value,
                };
                setServices(newServices);
              }}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.03)',
                color: '#fff',
                outline: 'none',
                flex: 1,
              }}
            />

            <button
              onClick={() =>
                setServices(
                  services.filter((_, idx) => idx !== i)
                )
              }
              style={{
                background: 'transparent',
                border: 'none',
                color: 'rgba(255,255,255,0.4)',
                cursor: 'pointer',
                fontSize: 16,
              }}
            >
              ✕
            </button>
          </div>
        ))}

        <button
          onClick={addService}
          className="fiducia-button fiducia-button-ghost"
          style={{ marginTop: 8 }}
        >
          + Add Schedule
        </button>
      </div>

      {/* Organization programs/events */}
      <div
        className="fiducia-card"
        style={{
          padding: 24,
          marginBottom: 30,
        }}
      >
        <h3
          style={{
            color: '#D4AF37',
            marginBottom: 16,
          }}
        >
          Programs / Events
        </h3>

        {programs.map((p, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: 10,
              marginBottom: 10,
            }}
          >
            <input
              placeholder="Program name"
              value={p.name}
              onChange={e => {
                const newPrograms = [...programs];
                newPrograms[i] = {
                  ...newPrograms[i],
                  name: e.target.value,
                };
                setPrograms(newPrograms);
              }}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.03)',
                color: '#fff',
                outline: 'none',
                flex: 1,
              }}
            />

            <button
              onClick={() =>
                setPrograms(
                  programs.filter((_, idx) => idx !== i)
                )
              }
              style={{
                background: 'transparent',
                border: 'none',
                color: 'rgba(255,255,255,0.4)',
                cursor: 'pointer',
                fontSize: 16,
              }}
            >
              ✕
            </button>
          </div>
        ))}

        <button
          onClick={addProgram}
          className="fiducia-button fiducia-button-ghost"
          style={{ marginTop: 8 }}
        >
          + Add Program
        </button>
      </div>

      <button
        onClick={saveProfile}
        className="fiducia-button fiducia-button-primary"
        style={{ width: '100%' }}
      >
        {saved ? 'Saved ✓' : 'Save Profile'}
      </button>
    </div>
  );
                                    }
