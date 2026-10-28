// Defense-in-depth tenant boundary for rows returned by organization-scoped queries.
// A contact's name or phone is not globally unique: only rows belonging to the
// authenticated organization may participate in identity checks or save decisions.
export function filterRowsToOrganization(rows, organizationId) {
  const tenantId = String(organizationId ?? '').trim();
  if (!tenantId || !Array.isArray(rows)) return [];
  return rows.filter(row => row && String(row.organization_id ?? '') === tenantId);
}
