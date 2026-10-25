// lib/aria/briefingProjection.js
// One canonical projection for Home's ARIA Today card and the Daily Briefing API.
// This is a read model: it never changes people, merges records, or completes actions.

import { attachDirectorContext } from './actionExplainability.js';

const HONORIFICS = /^(sis(?:ter)?|bro(?:ther)?|mrs?|miss|ms|pastor|past|pst|dr|rev|elder|deacon|deaconess)\s+/i;

function identityNameKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(HONORIFICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function identityPairKey(personA, personB) {
  return [String(personA || ''), String(personB || '')].sort().join(':');
}

function isIdentityReviewCandidate(item) {
  return Boolean(item?.person_id) && (
    item?.metadata?.kind === 'new_person_welcome' ||
    item?.metadata?.kind === 'new_person_context_review' ||
    item?.metadata?.first_visit_required === true ||
    item?.requires_context_review === true ||
    item?.metadata?.requires_context_review === true
  );
}

function rowToItem(row) {
  const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    ...payload,
    id: (payload && payload.id) || String(row?.source_id || row?.id || ''),
    source_id: String(row?.source_id || ''),
    queue_item_id: String(row?.id || ''),
    task_kind: String(row?.task_kind || payload?.task_kind || 'action'),
    queue_date: row?.queue_date,
    defer_count: Number(row?.defer_count) || 0,
    assigned_user_id: row?.assigned_user_id || null
  };
}

/**
 * Build the exact same current-day briefing projection for all entry points.
 * Candidate items include work scheduled for later so identity ambiguity is not
 * concealed merely because one of the records is outside today's short list.
 */
export function projectCanonicalBriefingItems(queue, director) {
  const items = (Array.isArray(queue?.items) ? queue.items : [])
    .map(rowToItem)
    .filter(item => item.title || item.message)
    .map(item => attachDirectorContext(item, director));

  const candidateItems = (Array.isArray(queue?.candidateItems) ? queue.candidateItems : items)
    .map(item => attachDirectorContext(item, director));

  return consolidateDuplicateIdentityItems(items, candidateItems, queue?.notDuplicateIdentityPairs || []);
}

export function consolidateDuplicateIdentityItems(items, candidateItems = items, notDuplicateIdentityPairs = []) {
  const explicitlySeparate = new Set((Array.isArray(notDuplicateIdentityPairs) ? notDuplicateIdentityPairs : [])
    .map(pair => identityPairKey(pair?.person_a_id, pair?.person_b_id)));
  const byName = new Map();

  for (const item of candidateItems) {
    if (!isIdentityReviewCandidate(item)) continue;
    const key = identityNameKey(item.title);
    if (!key) continue;
    const group = byName.get(key) || [];
    group.push(item);
    byName.set(key, group);
  }

  const groupedIds = new Set();
  const notices = [];

  for (const [nameKey, group] of byName) {
    const byPerson = new Map(group.map(item => [String(item.person_id), item]));
    if (byPerson.size < 2) continue;

    const records = [...byPerson.values()];
    const unresolvedPairs = [];
    for (let left = 0; left < records.length; left++) {
      for (let right = left + 1; right < records.length; right++) {
        const a = String(records[left].person_id);
        const b = String(records[right].person_id);
        if (!explicitlySeparate.has(identityPairKey(a, b))) unresolvedPairs.push([a, b].sort());
      }
    }
    if (!unresolvedPairs.length) continue;

    const ids = [...new Set(unresolvedPairs.flat())].sort();
    const involvedRecords = records.filter(item => ids.includes(String(item.person_id)));
    ids.forEach(id => groupedIds.add(id));

    const name = involvedRecords[0]?.title || 'These people';
    const hasMissingPhone = involvedRecords.some(item => item.has_contact_number === false);
    const unresolvedPairKey = unresolvedPairs.map(pair => pair.join(':')).sort().join('|');
    notices.push({
      id: 'identity-review:' + unresolvedPairKey,
      task_kind: 'identity_review',
      category: 'identity',
      source_id: '',
      person_id: null,
      priority: 95,
      title: 'Possible duplicate · ' + name,
      label: 'POSSIBLE DUPLICATE',
      message: 'The current and scheduled work includes items for ' + involvedRecords.length + ' active person records with the same normalized name and ' +
        unresolvedPairs.length + ' pair' + (unresolvedPairs.length === 1 ? '' : 's') + ' that have not been explicitly marked as different.' +
        (hasMissingPhone ? ' At least one record has no contact number.' : '') +
        ' NYEOCARE has not merged them; a matching name alone cannot establish identity.',
      what_happened: 'Open care items refer to multiple active person records with the normalized name "' + nameKey + '".',
      knowledge: 'Only unresolved person pairs are included. The available name evidence cannot prove whether these records represent one person or different people.',
      what_aria_knows: 'The current and scheduled candidate set includes open work for ' + involvedRecords.length + ' distinct active person records with this exact normalized name; ' + unresolvedPairs.length + ' pair(s) have not been explicitly marked as different. This is not a full People-directory duplicate scan.',
      why_attention: 'Identity must be checked before anyone merges records. A name match alone is not enough and merging the wrong records could combine two different people’s histories.',
      what_is_unknown: 'The name match does not establish that these are the same person. Compare phone evidence and other trustworthy context; do not infer identity from a shared name alone.',
      suggestion: 'Open Review Center → Duplicates and compare the available name and phone evidence for the listed records. Mark genuinely different people as separate; merge only if the evidence supports the same identity.',
      next_step: 'Open Review Center → Duplicates, compare the listed records, and explicitly keep different people separate. Merge only when the evidence supports the same identity.',
      source_label: 'Open care work · identity comparison',
      action: { type: 'review', label: 'Compare records' },
      metadata: {
        kind: 'possible_duplicate_identity',
        normalized_name: nameKey,
        person_ids: ids,
        record_count: involvedRecords.length,
        unresolved_pairs: unresolvedPairs.map(pair => pair.join(':')).sort()
      },
      created_at: involvedRecords.map(item => item.created_at).filter(Boolean).sort()[0] || null
    });
  }

  const visibleItems = items.filter(item => !(
    isIdentityReviewCandidate(item) &&
    item?.metadata?.first_visit_required !== true &&
    groupedIds.has(String(item.person_id))
  ));

  return [...visibleItems, ...notices].sort(
    (a, b) => Number(b.priority || 0) - Number(a.priority || 0) ||
      new Date(a.created_at || 0) - new Date(b.created_at || 0)
  );
}
