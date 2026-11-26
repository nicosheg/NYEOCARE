// lib/aria/contactPreference.js
export async function getRecordedContactPermission(db,organizationId,personId,actionMetadata={}) {
  if(!organizationId||!personId)throw new Error('organizationId and personId are required');

  const restriction=await db.query(
    `SELECT 1 FROM aria_care_contexts
     WHERE organization_id=$1 AND person_id=$2 AND kind='other'
       AND metadata->>'do_not_contact'='true'
       AND(ends_on IS NULL OR ends_on>=CURRENT_DATE)
     LIMIT 1`,
    [organizationId,personId]
  );
  if(restriction.rows.length)return 'do_not_contact';

  const latest=await db.query(
    `SELECT COALESCE(metadata->>'contact_permission',metadata->>'contact_preference') permission
     FROM aria_events
     WHERE organization_id=$1 AND person_id=$2
       AND type='COMMUNICATION_PREFERENCE_CHANGED'
       AND (metadata ? 'contact_permission' OR metadata ? 'contact_preference')
     ORDER BY occurred_at DESC,created_at DESC
     LIMIT 1`,
    [organizationId,personId]
  );
  const permission=String(latest.rows[0]?.permission||'unknown').toLowerCase();
  if(permission==='do_not_contact'||actionMetadata?.contact_permission==='do_not_contact')return 'do_not_contact';
  if(actionMetadata?.contact_permission==='allowed'||permission==='allowed')return 'allowed';
  return 'unknown';
}
