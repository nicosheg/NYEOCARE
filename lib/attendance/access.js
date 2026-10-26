// Attendance operators are application roles, not a person's relationship type.
export const ORGANIZATION_OPERATOR_ROLES = Object.freeze(['owner', 'admin', 'leader', 'worker']);

export function isOrganizationOperator(role) {
  return ORGANIZATION_OPERATOR_ROLES.includes(String(role ?? '').trim().toLowerCase());
}

export function isOrganizationAdmin(role) {
  const normalized = String(role ?? '').trim().toLowerCase();
  return normalized === 'owner' || normalized === 'admin';
}
