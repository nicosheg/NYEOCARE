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
  return `v77-${effort}-literal-partial-fields-json`;
}

export const SCAN_VISUAL_VERIFICATION_INSTRUCTION = [
  'Do one brief verification pass over the image before finalizing; keep reasoning effort low and hidden.',
  'Count distinct physical rows top to bottom, then verify every full literal name and honorific without spell-checking, shortening, title-casing, or replacing unfamiliar Nigerian or English names.',
  'For each physical row, independently check name, every visible phone digit, and any date of birth. A row with only one readable field is still valid output; never omit a phone-only or DOB-only row.',
  'Use Nigerian local and +234 phone formats as validation clues only. Preserve the actual visible digits and prefix; never swap or complete digits to make a number look valid.',
  'Check row ownership carefully. A blank-name line is a continuation only when its physical placement clearly proves it belongs to the immediately preceding person; otherwise keep it separate and flag it for review.',
  'Do not split one written row into multiple people or collapse distinct rows. Do not transfer a phone or DOB based on name similarity, frequency, or proximity alone.',
  'Return only the compact JSON object required by the response schema. Do not output rationale, analysis, markdown, or a <think> block. If uncertain, preserve literal evidence and set the applicable uncertainty flag.'
].join(' ');
