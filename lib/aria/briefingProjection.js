// lib/aria/briefingProjection.js
// One canonical projection for Home's ARIA Today card and the Daily Briefing API.
// This is a read model: it never changes people, merges records, or completes actions.

import { attachDirectorContext } from './actionExplainability';

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

  return consolidateDuplicateIdentityItems(items, candidateItems);
}

export function consolidateDuplicateIdentityItems(items, candidateItems = items) {
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
    const ids = records.map(item => String(item.person_id)).sort();
    ids.forEach(id => groupedIds.add(id));

    const name = records[0].title || 'These people';
    const hasMissingPhone = records.some(item => item.has_contact_number === false);
    notices.push({
      id: 'identity-review:' + ids.join(':'),
      task_kind: 'identity_review',
      category: 'identity',
      source_id: '',
      person_id: null,
      priority: 95,
      title: 'Possible duplicate · ' + name,
      label: 'POSSIBLE DUPLICATE',
      message: 'There are ' + records.length + ' active records with the same normalized name.' +
        (hasMissingPhone ? ' At least one record has no contact number.' : '') +
        ' NYEOCARE has not merged them; a matching name alone cannot establish identity.',
      knowledge: 'The records share a name, but the available name evidence cannot prove whether they represent one person or different people.',
      suggestion: 'Open Review Center → Duplicates and compare the available name and phone evidence. Merge only if the evidence supports the same identity; otherwise keep the records separate.',
      action: { type: 'review', label: 'Compare records' },
      metadata: {
        kind: 'possible_duplicate_identity',
        normalized_name: nameKey,
        person_ids: ids,
        record_count: records.length
      },
      created_at: records.map(item => item.created_at).filter(Boolean).sort()[0] || null
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
