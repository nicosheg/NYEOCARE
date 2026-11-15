// components/PeopleEditIdentityDecision.js
import { useEffect, useState } from 'react';
import { getClientSession, refreshClientSession } from '../lib/clientSession';

function displayName(person) {
  return String(person?.display_name || [person?.first_name, person?.last_name].filter(Boolean).join(' ') || person?.name || 'Unnamed person').trim();
}

function reviewMessage(error) {
  if (error?.code === 'IDENTITY_EDIT_TARGET_STALE') {
    return 'The original record changed while this review was open. The review is still pending with refreshed details. Open the full review and compare again.';
  }
  if (error?.code === 'PERSON_IDENTITY_REVIEW_STALE') {
    return 'The possible matches changed. This review remains pending with refreshed evidence. Open the full review before deciding.';
  }
  if (error?.code === 'IDENTITY_REVIEW_NOT_FOUND') {
    return 'This review may already have been completed by another operator. Refresh Review Center to confirm its current status.';
  }
  return error?.message || 'NYEOCARE could not verify that decision. The review remains pending and no change was applied.';
}

export default function PeopleEditIdentityDecision({
  review,
  sourceName,
  surface = 'people',
  onOpenReview,
  onResolved
}) {
  const candidates = Array.isArray(review?.candidates) ? review.candidates : [];
  const reviewId = String(review?.review_id || review?.source_review_id || '').replace(/^identity:/, '');
  const existingDifferentPending = review?.code === 'PERSON_IDENTITY_REVIEW_IN_PROGRESS';
  const activeCandidates = candidates.filter(candidate => String(candidate?.status || '').toLowerCase() === 'active');
  const initialCandidateId = String((activeCandidates[0] || candidates[0])?.id || '');
  const [selectedId, setSelectedId] = useState(initialCandidateId);
  const [confirmAction, setConfirmAction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setSelectedId(initialCandidateId);
    setConfirmAction('');
    setError('');
  }, [reviewId, initialCandidateId]);

  const selectedCandidate = candidates.find(candidate => String(candidate.id) === String(selectedId));
  const selectedCanBeMain = String(selectedCandidate?.status || '').toLowerCase() === 'active';

  async function decide(action) {
    if (!reviewId || busy) return;
    if (action === 'merge' && (!selectedCandidate || !selectedCanBeMain)) {
      setError('Choose an active existing person to remain as the main record.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      let session = await getClientSession();
      if (!session) throw new Error('Your session expired. Sign in again before completing this decision.');
      const send = token => fetch('/api/review/person-identity-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          id: reviewId,
          action,
          ...(action === 'merge' ? { canonicalId: String(selectedCandidate.id) } : {})
        }),
        cache: 'no-store'
      });
      let response = await send(session.access_token);
      if (response.status === 401) {
        session = await refreshClientSession().catch(() => null);
        if (!session?.access_token) throw new Error('Your session expired. Sign in again before completing this decision.');
        response = await send(session.access_token);
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const failure = Object.assign(new Error(reviewMessage({ code: data.code, message: data.error })), {
          code: data.code || null,
          status: response.status
        });
        throw failure;
      }
      if (data?.verified !== true || data?.persisted !== true || data?.review_status !== 'resolved' || !data?.person_id) {
        throw new Error('NYEOCARE did not verify the decision. This review remains pending; no information was cleared.');
      }
      setConfirmAction('');
      try {
        await onResolved?.(action, data);
      } catch (refreshFailure) {
        setError('Your decision was saved and verified. This screen could not refresh automatically; reopen People or Review Center to confirm the updated record.');
      }
    } catch (failure) {
      setError(reviewMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  const candidateName = selectedCandidate ? displayName(selectedCandidate) : 'the selected person';
  const originalName = String(sourceName || review?.original_person?.display_name || 'this person').trim();

  return (
    <section
      role="alert"
      aria-labelledby="people-identity-decision-title"
      data-person-edit-identity-review={surface === 'people' ? 'true' : undefined}
      data-person-journey-identity-review={surface === 'journey' ? 'true' : undefined}
      style={{
        padding: 12,
        border: '1px solid rgba(212,175,55,.34)',
        borderRadius: 14,
        background: 'linear-gradient(145deg,rgba(212,175,55,.075),rgba(255,255,255,.025))',
        display: 'grid',
        gap: 10,
        color: '#F5F7FA'
      }}
    >
      <div>
        <div style={{ fontSize: 9, letterSpacing: 1.4, textTransform: 'uppercase', color: '#D6B86A', fontWeight: 750 }}>
          Identity check · decision needed
        </div>
        <h3 id="people-identity-decision-title" style={{ fontSize: 14, margin: '5px 0 4px', color: '#F3E4B3' }}>
          {existingDifferentPending ? 'An earlier edit review is already waiting' : 'Possible duplicate detected'}
        </h3>
        <p style={{ fontSize: 12, lineHeight: 1.5, color: 'rgba(255,255,255,.72)', margin: 0 }}>
          {existingDifferentPending ? (
            <>A different version of this edit is already waiting in Review Center. The latest changes you just tried were <strong>not added</strong> to that review. To avoid deciding against the wrong details, open the existing item and update its proposal there. <strong>{originalName}</strong> remains unchanged.</>
          ) : (
            <>Your proposed edit is safely held in Review Center. <strong>{originalName}</strong> has not been changed. Compare the possible match below, then choose what should happen. Only people in this organization are included.</>
          )}
        </p>
      </div>

      {!existingDifferentPending && candidates.length > 0 ? (
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,.44)', textTransform: 'uppercase', letterSpacing: 1 }}>
            Existing people to compare
          </div>
          {candidates.map(candidate => {
            const isSelected = String(candidate.id) === String(selectedId);
            const active = String(candidate.status || '').toLowerCase() === 'active';
            const evidence = candidate.phone_match
              ? 'Phone also matches'
              : candidate.name_match
                ? 'Name matches'
                : candidate.similar_name
                  ? 'Similar name'
                  : 'Related identity evidence';
            return (
              <button
                type="button"
                key={candidate.id}
                aria-pressed={isSelected}
                disabled={busy}
                onClick={() => { setSelectedId(String(candidate.id)); setConfirmAction(''); setError(''); }}
                style={{
                  width: '100%',
                  minWidth: 0,
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0,1fr) auto',
                  gap: 8,
                  alignItems: 'center',
                  padding: '9px 10px',
                  borderRadius: 11,
                  border: isSelected ? '1px solid rgba(212,175,55,.55)' : '1px solid rgba(255,255,255,.09)',
                  background: isSelected ? 'rgba(212,175,55,.09)' : 'rgba(255,255,255,.035)',
                  color: '#F5F7FA',
                  textAlign: 'left',
                  cursor: busy ? 'wait' : 'pointer'
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <strong style={{ display: 'block', fontSize: 12, overflowWrap: 'anywhere' }}>{displayName(candidate)}</strong>
                  <span style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,.55)', marginTop: 3 }}>
                    {candidate.phone || 'No phone recorded'} · {evidence}
                  </span>
                  {!active && (
                    <span style={{ display: 'block', fontSize: 10, color: '#D6B86A', marginTop: 3 }}>
                      {candidate.status || 'Inactive'} · cannot be the main record for a merge
                    </span>
                  )}
                </span>
                <span aria-hidden="true" style={{ color: isSelected ? '#EAD795' : 'rgba(255,255,255,.4)', fontSize: 16 }}>
                  {isSelected ? '●' : '○'}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <p style={{ fontSize: 11, lineHeight: 1.45, color: 'rgba(255,255,255,.58)', margin: 0 }}>
          {existingDifferentPending ? 'Open the existing pending review to inspect and update the version that was actually saved.' : 'The saved review needs a fresh comparison before a decision can be made. Open the full review to inspect the current records.'}
        </p>
      )}

      {!confirmAction ? (
        existingDifferentPending ? (
          <button
            type="button"
            onClick={() => onOpenReview?.(reviewId)}
            disabled={busy || !reviewId}
            style={{
              width: '100%', minHeight: 39, padding: '8px 10px',
              border: '1px solid rgba(255,255,255,.12)', borderRadius: 10,
              background: 'rgba(255,255,255,.035)', color: '#F5F7FA', fontSize: 11, fontWeight: 700
            }}
          >
            Open existing review
          </button>
        ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
          <button
            type="button"
            onClick={() => { setConfirmAction('merge'); setError(''); }}
            disabled={busy || !selectedCanBeMain || candidates.length === 0 || !reviewId}
            style={{
              minHeight: 39, padding: '8px 9px', border: 0, borderRadius: 10,
              background: '#EAD795', color: '#111827', fontSize: 11, fontWeight: 750,
              opacity: busy || !selectedCanBeMain || candidates.length === 0 || !reviewId ? .45 : 1
            }}
          >
            Merge records
          </button>
          <button
            type="button"
            onClick={() => { setConfirmAction('keep_separate'); setError(''); }}
            disabled={busy || candidates.length === 0 || !reviewId}
            style={{
              minHeight: 39, padding: '8px 9px', border: '1px solid rgba(212,175,55,.3)', borderRadius: 10,
              background: 'rgba(212,175,55,.07)', color: '#F0DFAE', fontSize: 11, fontWeight: 700,
              opacity: busy || candidates.length === 0 || !reviewId ? .45 : 1
            }}
          >
            Keep separate
          </button>
          <button
            type="button"
            onClick={() => onOpenReview?.(reviewId)}
            disabled={busy || !reviewId}
            style={{
              gridColumn: '1 / -1', minHeight: 37, padding: '8px 10px',
              border: '1px solid rgba(255,255,255,.12)', borderRadius: 10,
              background: 'rgba(255,255,255,.035)', color: '#F5F7FA', fontSize: 11, fontWeight: 650
            }}
          >
            Open full review
          </button>
        </div>
        )
      ) : (
        <div style={{ padding: 10, border: '1px solid rgba(255,255,255,.10)', borderRadius: 11, background: 'rgba(4,9,19,.35)', display: 'grid', gap: 8 }}>
          <strong style={{ fontSize: 12, color: '#F3E4B3' }}>Confirm your choice</strong>
          <p style={{ fontSize: 11, lineHeight: 1.5, color: 'rgba(255,255,255,.68)', margin: 0 }}>
            {confirmAction === 'merge'
              ? `Merge ${originalName} into ${candidateName}? The selected person remains the main record. The edited record is archived only after its history and details are safely reconciled.`
              : `Save the proposed edit on ${originalName} and keep both people separate? Both records remain in People, and NYEOCARE records your decision so it does not keep asking about this same pair.`}
          </p>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => decide(confirmAction)}
              disabled={busy}
              style={{ flex: '1 1 145px', minHeight: 39, padding: '8px 10px', border: 0, borderRadius: 10, background: '#EAD795', color: '#111827', fontSize: 11, fontWeight: 750, opacity: busy ? .55 : 1 }}
            >
              {busy ? 'Saving decision…' : confirmAction === 'merge' ? 'Confirm merge' : 'Save edit & keep both'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmAction('')}
              disabled={busy}
              style={{ flex: '1 1 95px', minHeight: 39, padding: '8px 10px', border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, background: 'rgba(255,255,255,.035)', color: '#F5F7FA', fontSize: 11 }}
            >
              Go back
            </button>
          </div>
        </div>
      )}

      {error && (
        <div role="status" aria-live="polite" style={{ fontSize: 11, lineHeight: 1.45, color: '#F2C3A9', padding: '8px 9px', borderRadius: 9, background: 'rgba(215,123,123,.08)' }}>
          {error}
          {reviewId && <button type="button" onClick={() => onOpenReview?.(reviewId)} disabled={busy} style={{ display: 'block', marginTop: 6, padding: 0, border: 0, background: 'none', color: '#EAD795', textDecoration: 'underline', fontSize: 11 }}>Open full review</button>}
        </div>
      )}
    </section>
  );
}
