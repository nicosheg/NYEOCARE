// Attendance operators are application roles, not a person's relationship type.
// `user` is the persisted legacy application-account role. It is still an operator role;
// a person's People type (`visitor`/`member`) is stored separately and never grants access.
export const ORGANIZATION_OPERATOR_ROLES = Object.freeze(['owner', 'admin', 'leader', 'worker', 'user']);

export function isOrganizationOperator(role) {
  return ORGANIZATION_OPERATOR_ROLES.includes(String(role ?? '').trim().toLowerCase());
}

export function isOrganizationAdmin(role) {
  const normalized = String(role ?? '').trim().toLowerCase();
  return normalized === 'owner' || normalized === 'admin';
}
