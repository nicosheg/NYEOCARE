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

/**
 * Ensure an authenticated operator belongs to an active attendance session.
 * Existing members may still read a closed session while its ARIA processing is pending.
 * New membership is never added to a closed session or across an organization boundary.
 */
export async function ensureActiveAttendanceSessionMember(db, { organizationId, sessionId, userId }) {
  if (!db?.query || !organizationId || !sessionId || !userId) return false;

  const params = [
    String(sessionId),
    String(organizationId),
    String(userId),
    ORGANIZATION_OPERATOR_ROLES
  ];

  const existing = await db.query(
    `SELECT 1
     FROM public.sessions s
     JOIN public.session_users su ON su.session_id = s.id AND su.user_id = $3
     JOIN public.users u
       ON u.id = su.user_id
      AND u.organization_id = s.organization_id
      AND u.active = true
      AND lower(BTRIM(u.role)) = ANY($4::text[])
     WHERE s.id = $1
       AND s.organization_id = $2
     LIMIT 1`,
    params
  );
  if (existing.rows.length) return true;

  await db.query(
    `INSERT INTO public.session_users (session_id, user_id)
     SELECT s.id, u.id
     FROM public.sessions s
     JOIN public.users u
       ON u.id = $3
      AND u.organization_id = s.organization_id
      AND u.active = true
      AND lower(BTRIM(u.role)) = ANY($4::text[])
     WHERE s.id = $1
       AND s.organization_id = $2
       AND s.status = 'active'
     ON CONFLICT (session_id, user_id) DO NOTHING`,
    params
  );

  // A concurrent join is successful too. Re-read rather than relying on INSERT rowCount,
  // which is zero when another request inserted the same membership first.
  const confirmed = await db.query(
    `SELECT 1
     FROM public.sessions s
     JOIN public.session_users su ON su.session_id = s.id AND su.user_id = $3
     JOIN public.users u
       ON u.id = su.user_id
      AND u.organization_id = s.organization_id
      AND u.active = true
      AND lower(BTRIM(u.role)) = ANY($4::text[])
     WHERE s.id = $1
       AND s.organization_id = $2
     LIMIT 1`,
    params
  );
  return confirmed.rows.length > 0;
}
