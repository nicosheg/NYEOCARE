// lib/scanPhoneEvidence.mjs
const BLOCKED_REASONS = new Set([
  'phone_evidence_ambiguous',
  'low_phone_evidence',
  'row_evidence_needs_verification',
  'phone_possible_digit_error',
  'phone_belongs_to_another_row',
  'phone_row_linkage_needs_verification',
  'shared_phone_in_scan',
  'phone_observed_on_multiple_rows',
  'phone_number_not_safely_validated',
  'too_many_phone_numbers'
]);
const BLOCKED_FLAGS = new Set([
  'digit_uncertain',
  'missing_digit_possible',
  'extra_digit_possible',
  'number_visually_corrupted',
  'continuation_uncertain',
  'row_ownership_uncertain'
]);

export function isSafeScanPhoneEvidence(evidence = {}, reviewReasons = []) {
  if (evidence?.phone_evidence !== 'clear' || evidence?.pair_evidence !== 'clear') return false;
  const reasons = [
    ...(Array.isArray(reviewReasons) ? reviewReasons : []),
    ...(Array.isArray(evidence?.extraction_review_reasons) ? evidence.extraction_review_reasons : [])
  ].map(value => String(value || '').trim());
  const flags = Array.isArray(evidence?.phone_flags) ? evidence.phone_flags.map(value => String(value || '').trim()) : [];
  return !reasons.some(reason => BLOCKED_REASONS.has(reason))
    && !flags.some(flag => BLOCKED_FLAGS.has(flag));
}

const BLOCKED_NAME_REASONS = new Set([
  'name_evidence_ambiguous',
  'low_name_evidence',
  'current_image_conflicts_with_learning',
  'name_handwriting_unclear'
]);
const BLOCKED_NAME_FLAGS = new Set(['name_uncertain']);

export function isSafeScanNameEvidence(evidence = {}, reviewReasons = []) {
  if (evidence?.name_evidence !== 'clear') return false;
  const reasons = [
    ...(Array.isArray(reviewReasons) ? reviewReasons : []),
    ...(Array.isArray(evidence?.extraction_review_reasons) ? evidence.extraction_review_reasons : [])
  ].map(value => String(value || '').trim());
  const flags = Array.isArray(evidence?.phone_flags) ? evidence.phone_flags.map(value => String(value || '').trim()) : [];
  return !reasons.some(reason => BLOCKED_NAME_REASONS.has(reason))
    && !flags.some(flag => BLOCKED_NAME_FLAGS.has(flag));
}
