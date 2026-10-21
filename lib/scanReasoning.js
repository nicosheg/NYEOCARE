// lib/scanReasoning.js
// Keep vision reasoning bounded and keep the provider response machine-readable.
export function resolveScanReasoningEffort(value = process.env.SCAN_REASONING_EFFORT) {
  const normalized = String(value ?? '').trim().toLowerCase();
  // Production default is deliberately LOW rather than disabled. Set the
  // environment variable to "none" only as an emergency rollback.
  return normalized === 'none' ? 'none' : 'low';
}

export function getScanPipelineVersion(reasoningEffort, viewMode = 'multiview') {
  const effort = resolveScanReasoningEffort(reasoningEffort) === 'low'
    ? 'low-reasoning'
    : 'no-reasoning';
  const view = viewMode === 'full_page' ? 'full-page' : 'multiview';
  return `v75-${effort}-${view}-json`;
}

export const SCAN_VISUAL_VERIFICATION_INSTRUCTION = [
  'Before finalizing, make one brief verification pass over the image.',
  'Count the written rows from top to bottom; re-check each complete name including its honorific and every visible character.',
  'For unclear strokes, compare repeated handwriting on this same page; do not normalize, complete, or silently correct a name.',
  'Check that one physical row has not been split into two people and that two distinct rows have not been collapsed.',
  'Read a phone number or date of birth only when it is visibly written and physically belongs to that row.',
  'Use low-effort visual reasoning. Do not output an explanation, rationale, analysis, or <think> block.',
  'Return only the compact JSON object required by the response schema. If uncertain, preserve the best literal evidence and set the relevant uncertainty flag.'
].join(' ');
