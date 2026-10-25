// lib/aria/actionExplainability.js
// Deterministic, evidence-first explanations for ARIA Today.
// This layer formats existing NYEOCARE records; it never invents facts or executes actions.

const VAGUE = [
  /has a signal worth your attention/i,
  /found a meaningful change worth reviewing/i,
  /found a meaningful signal/i,
  /found a signal worth your attention/i,
  /review the signal and decide what to do/i,
  /review this signal/i,
  /meaningful change has appeared/i,
  /aria detected a meaningful signal/i,
  /aria found a signal worth your attention/i
];

const TYPE_LABELS = {
  NEW_PERSON: 'new-person signal',
  UNUSUAL_ABSENCE: 'absence-related signal',
  LOW_ENGAGEMENT: 'change in recorded engagement',
  ATTENDANCE_CHANGE: 'change in attendance records',
  CARE_RISK: 'care-related signal',
  POSSIBLE_DUPLICATE: 'possible duplicate-record signal',
  PATTERN: 'emerging pattern',
  RETURNED_AFTER_ABSENCE: 'recorded return after an absence signal',
  RELATIONSHIP_CREATED: 'new recorded relationship',
  RELATIONSHIP_CHANGE: 'recorded relationship change',
  RELATIONSHIP_CORRECTED: 'relationship correction',
  CONTRIBUTION_OPPORTUNITY: 'possible opportunity to contribute',
  RECOGNITION_OPPORTUNITY: 'possible recognition opportunity',
  BELONGING_OPPORTUNITY: 'possible belonging opportunity',
  EXTENDED_ABSENCE: 'extended absence pattern',
  EMERGING_ATTENDANCE_DECLINE: 'change in attendance pattern',
  NEW_RELATIONSHIP: 'new relationship signal'
};

function clean(value, max = 360) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function isUseful(value) {
  const text = clean(value);
  return Boolean(text) && !VAGUE.some(pattern => pattern.test(text));
}

function firstUseful(...values) {
  for (const value of values) {
    const text = clean(value);
    if (isUseful(text)) return text;
  }
  return '';
}

function textList(value) {
  if (typeof value === 'string') return [clean(value)].filter(Boolean);
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    if (typeof item === 'string') return clean(item);
    if (item && typeof item === 'object') {
      return clean(item.fact || item.statement || item.summary || item.description || item.label || '');
    }
    return '';
  }).filter(Boolean);
}

function unique(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = item.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function typeKey(value) {
  return String(value || '').trim().toUpperCase().replace(/[ -]+/g, '_');
}

function typeLabel(type) {
  return TYPE_LABELS[type] || (type ? type.toLowerCase().replace(/_/g, ' ') : 'organizational');
}

function unknownFor(type, isWelcome) {
  if (isWelcome || type === 'NEW_PERSON' || type === 'NEW_RELATIONSHIP') {
    return 'The record does not establish whether someone has already welcomed them or whether contact is welcome.';
  }
  if (['UNUSUAL_ABSENCE', 'EXTENDED_ABSENCE', 'RETURNED_AFTER_ABSENCE'].includes(type)) {
    return 'The record does not explain the person’s circumstances; an attendance signal is not a reason or a verdict.';
  }
  if (['LOW_ENGAGEMENT', 'EMERGING_ATTENDANCE_DECLINE', 'ATTENDANCE_CHANGE'].includes(type)) {
    return 'The recorded pattern does not establish why participation changed.';
  }
  if (type === 'POSSIBLE_DUPLICATE') {
    return 'A matching name alone cannot prove that two records belong to the same person.';
  }
  if (type === 'CARE_RISK') {
    return 'The signal alone is not a confirmed explanation; verify the underlying evidence before acting.';
  }
  if (['CONTRIBUTION_OPPORTUNITY', 'RECOGNITION_OPPORTUNITY', 'BELONGING_OPPORTUNITY'].includes(type)) {
    return 'ARIA cannot infer personal preferences or willingness from this signal alone.';
  }
  return 'The available record does not yet establish the full context or the person’s reasons.';
}

function nextStepFor(type, isWelcome, firstVisitRequired, taskKind) {
  if (firstVisitRequired) {
    return 'Check whether anyone has already connected with them, then record what actually happened. Contact is optional; respect their preference.';
  }
  if (isWelcome || type === 'NEW_PERSON' || type === 'NEW_RELATIONSHIP') {
    return 'Check whether a welcome has already happened. If not, offer a short, no-pressure welcome and record the outcome.';
  }
  if (['UNUSUAL_ABSENCE', 'EXTENDED_ABSENCE', 'RETURNED_AFTER_ABSENCE'].includes(type)) {
    return 'Verify the linked attendance record, then offer a gentle check-in if appropriate. Do not assume why they were absent.';
  }
  if (['LOW_ENGAGEMENT', 'EMERGING_ATTENDANCE_DECLINE'].includes(type)) {
    return 'Review recent participation and any recorded context first; then decide whether a personal check-in would help.';
  }
  if (type === 'ATTENDANCE_CHANGE') {
    return 'Check the linked attendance events and correct any error before deciding whether to contact the person.';
  }
  if (type === 'POSSIBLE_DUPLICATE') {
    return 'Open Review Center → Duplicates and compare the records. Do not merge on a matching name alone.';
  }
  if (type === 'CARE_RISK') {
    return 'Review the underlying evidence with an authorized leader before taking any sensitive action.';
  }
  if (['CONTRIBUTION_OPPORTUNITY', 'RECOGNITION_OPPORTUNITY', 'BELONGING_OPPORTUNITY'].includes(type)) {
    return 'Check the person’s recorded preferences and existing commitments. Offer an option only if it fits, and let them choose freely.';
  }
  if (taskKind === 'follow_up') {
    return 'Review the recorded context, choose a respectful next step, and record the actual outcome.';
  }
  return 'Open the linked record and verify the evidence. Then choose or prepare the next step; no external action has been taken by this signal.';
}

export function explainAriaAction({
  personName = '',
  taskKind = 'action',
  actionType = '',
  observationType = '',
  evidence = {},
  observationMetadata = {},
  actionMetadata = {},
  confidence = null,
  detectedAt = null
} = {}) {
  const metadata = actionMetadata && typeof actionMetadata === 'object' ? actionMetadata : {};
  const meta = observationMetadata && typeof observationMetadata === 'object' ? observationMetadata : {};
  const ev = evidence && typeof evidence === 'object' ? evidence : {};
  const summary = metadata.evidence_summary && typeof metadata.evidence_summary === 'object'
    ? metadata.evidence_summary
    : {};
  const type = typeKey(observationType || summary.type || ev.type || meta.type || actionType);
  const isWelcome = metadata.kind === 'new_person_welcome' || metadata.kind === 'welcome';
  const firstVisitRequired = metadata.first_visit_required === true;
  const name = clean(personName, 120) || 'this record';

  const facts = unique([
    ...textList(ev.facts),
    ...textList(summary.facts),
    ev.fact,
    summary.fact
  ].map(value => clean(value, 300)).filter(isUseful)).slice(0, 3);

  const inference = firstUseful(ev.inference, summary.inference, meta.inference);
  const typeDescription = typeLabel(type);
  const explicitEvent = firstUseful(
    ev.fact,
    summary.fact,
    ev.summary,
    summary.summary,
    metadata.summary,
    metadata.message,
    meta.summary,
    meta.message,
    ev.description,
    summary.description
  );

  let whatHappened = explicitEvent;
  if (!whatHappened) {
    const article = /^[aeiou]/i.test(typeDescription) ? 'an ' : 'a ';
    whatHappened = isWelcome
      ? 'A welcome follow-up is open for ' + name + '.'
      : 'NYEOCARE recorded ' + article + typeDescription + ' for ' + name + '.';
  }

  const unknown = unknownFor(type, isWelcome);
  const whyFromRecord = firstUseful(metadata.why_now, metadata.reason, metadata.rationale, meta.why_now, meta.reason);
  let whyAttention = whyFromRecord;
  if (!whyAttention && inference) whyAttention = 'ARIA’s interpretation: ' + inference;
  if (!whyAttention) {
    if (firstVisitRequired) whyAttention = 'A required first-visit care outcome is still open and needs a truthful human-recorded outcome.';
    else if (isWelcome || type === 'NEW_PERSON' || type === 'NEW_RELATIONSHIP') whyAttention = 'This record is newly known; a welcome may be useful, but the system cannot confirm one has happened.';
    else if (['UNUSUAL_ABSENCE', 'EXTENDED_ABSENCE', 'RETURNED_AFTER_ABSENCE'].includes(type)) whyAttention = 'This is an attendance observation, not proof that anything is wrong.';
    else if (['LOW_ENGAGEMENT', 'EMERGING_ATTENDANCE_DECLINE'].includes(type)) whyAttention = 'Recorded participation may be changing, but the cause is not known.';
    else if (type === 'ATTENDANCE_CHANGE') whyAttention = 'The records show a change that should be checked before taking action.';
    else if (type === 'POSSIBLE_DUPLICATE') whyAttention = 'Identity needs a human comparison before any records are merged.';
    else if (type === 'CARE_RISK') whyAttention = 'A person-related concern requires evidence review before a sensitive response.';
    else if (['CONTRIBUTION_OPPORTUNITY', 'RECOGNITION_OPPORTUNITY', 'BELONGING_OPPORTUNITY'].includes(type)) whyAttention = 'There may be a useful opportunity, but the person’s preferences must guide any offer.';
    else whyAttention = 'The record needs a human review before a more specific conclusion can be trusted.';
  }

  const genericSuggestion = !isUseful(metadata.suggestion);
  const nextStep = firstVisitRequired || isWelcome
    ? nextStepFor(type, isWelcome, firstVisitRequired, taskKind)
    : (!genericSuggestion ? clean(metadata.suggestion, 360) : nextStepFor(type, false, false, taskKind));

  let knowledge = facts.slice(0, 2).join(' ');
  if (!knowledge) knowledge = 'The available record confirms only that a ' + typeDescription + ' was flagged.';
  if (inference && !knowledge.toLowerCase().includes(inference.toLowerCase())) {
    knowledge = (knowledge + ' ARIA’s interpretation: ' + inference).slice(0, 700);
  }

  const recordedAt = detectedAt || summary.detected_at || ev.detected_at || meta.detected_at || metadata.proposed_at || null;
  const actionLabel = firstVisitRequired ? 'Record outcome' : isWelcome ? 'Draft welcome' : ({NEW_PERSON:'Check welcome',UNUSUAL_ABSENCE:'Review check-in',EXTENDED_ABSENCE:'Review check-in',LOW_ENGAGEMENT:'Review context',EMERGING_ATTENDANCE_DECLINE:'Review context',ATTENDANCE_CHANGE:'Check records',CARE_RISK:'Review evidence',POSSIBLE_DUPLICATE:'Compare records',PATTERN:'Review pattern',CONTRIBUTION_OPPORTUNITY:'Review opportunity',RECOGNITION_OPPORTUNITY:'Review opportunity',BELONGING_OPPORTUNITY:'Review opportunity'})[type] || (taskKind === 'follow_up' ? 'Review check-in' : 'See next step');
  const usableConfidence = confidence !== null && confidence !== undefined && Number.isFinite(Number(confidence)) ? Number(confidence) : (summary.confidence !== null && summary.confidence !== undefined && Number.isFinite(Number(summary.confidence)) ? Number(summary.confidence) : null);
  return {
    what_happened: whatHappened.slice(0, 420),
    why_attention: clean(whyAttention, 420),
    what_aria_knows: clean(knowledge, 700),
    what_is_unknown: unknown,
    next_step: clean(nextStep, 420),
    action_label: actionLabel,
    evidence_facts: facts.slice(0, 2),
    confidence: usableConfidence,
    source_label: observationType || summary.observation_id ? 'ARIA observation' : 'ARIA action',
    recorded_at: recordedAt
  };
}

// The Director's person-specific attendance lens is attached only when the
// queued item itself is attendance-related and references the same person.
// Organization-wide priorities are deliberately not presented as personal evidence.
export function attachDirectorContext(item, director) {
  if (!item || !item.person_id) return item;
  const type = typeKey(item.observation_type || item.metadata?.evidence_summary?.type || item.action_type);
  if (!/(ATTENDANCE|ABSENCE|ENGAGEMENT|PARTICIPATION|PRESENCE|RETURN)/.test(type)) return item;
  const lens = director?.intelligence?.attendance_lens;
  if (!Array.isArray(lens)) return item;
  const match = lens.find(entry => String(entry?.person_id || '') === String(item.person_id));
  if (!match || !isUseful(match.reason)) return item;
  return {
    ...item,
    director_context: {
      label: 'Across their recorded history',
      reason: clean(match.reason, 420),
      classification: clean(match.classification, 100) || null
    }
  };
}
