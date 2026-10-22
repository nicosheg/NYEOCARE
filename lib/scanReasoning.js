// lib/scanReasoning.js
// Keep vision reasoning bounded and keep the provider response machine-readable.
export function resolveScanReasoningEffort(value = process.env.SCAN_REASONING_EFFORT) {
  const normalized = String(value ?? '').trim().toLowerCase();
  // Production default is deliberately LOW rather than disabled. Set the
  // environment variable to "none" only as an emergency rollback.
  return normalized === 'none' ? 'none' : 'low';
}

export function getScanPipelineVersion(reasoningEffort) {
  const effort = resolveScanReasoningEffort(reasoningEffort) === 'low'
    ? 'low-reasoning'
    : 'no-reasoning';
  return `v78-${effort}-two-pass-topdown-display-normalized-json`;
}

export const SCAN_VISUAL_VERIFICATION_INSTRUCTION = [
  'Do one brief verification pass over the image before finalizing; keep reasoning effort low and hidden.',
  'Use two passes: first enumerate every person-bearing record top to bottom and assign sequential r values; second transcribe and verify each record against the image, then check the first, middle, and final rows again.',
  'Return records in ascending r order with no gaps or duplicates. r is the one-based source-order record index; y is only an approximate visual coordinate and must not override the verified reading order.',
  'Preserve the full literal name in source evidence. For display, standard casing is applied by deterministic backend code; do not use learning cues to silently substitute uncertain name letters.',
  'Inspect SIS title shapes carefully against repeated instances on this same page and the available human-reviewed ARIA learning cues. Treat those cues as attention guidance, never as automatic letter replacement.',
  'For each physical row, independently check name, every visible phone digit, and any date of birth. A row with only one readable field is still valid output; never omit a phone-only or DOB-only row.',
  'Use Nigerian local and +234 phone formats as validation clues only. Preserve the actual visible digits and prefix; never swap or complete digits to make a number look valid.',
  'Check row ownership carefully. A blank-name line is a continuation only when its physical placement clearly proves it belongs to the immediately preceding person; otherwise keep it separate and flag it for review.',
  'Do not split one written row into multiple people or collapse distinct rows. Do not transfer a phone or DOB based on name similarity, frequency, or proximity alone.',
  'Return only the compact JSON object required by the response schema. Do not output rationale, analysis, markdown, or a <think> block. If uncertain, preserve literal evidence and set the applicable uncertainty flag.'
].join(' ');
