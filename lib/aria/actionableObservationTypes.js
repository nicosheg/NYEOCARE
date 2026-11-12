// lib/aria/actionableObservationTypes.js
// Only observations that can reasonably change a human decision belong in an operator attention queue.
export const ACTIONABLE_OBSERVATION_TYPES=Object.freeze([
 'UNUSUAL_ABSENCE',
 'ATTENDANCE_NOT_OBSERVED',
 'SCAN_REVIEW_REQUIRED',
 'ARIA_PROCESSING_FAILURE',
 'CONFLICT',
 'DATA_INTEGRITY',
 'SECURITY_REVIEW'
]);
