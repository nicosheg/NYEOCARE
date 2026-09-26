-- Collapse stale duplicate proposed return-after-absence actions.
-- Keep the newest proposal per person; history remains in aria_actions.
WITH ranked AS(
 SELECT id,
        ROW_NUMBER() OVER(PARTITION BY person_id ORDER BY proposed_at DESC,id DESC) rn
 FROM aria_actions
 WHERE organization_id='org_44497dd8ebdd4767830c8cd193271c09'
   AND status='proposed'
   AND action_metadata->>'kind'='returned_after_absence'
)
UPDATE aria_actions a
SET status='cancelled',
    failure_reason='Superseded by a newer return-after-absence proposal for the same person.',
    updated_at=NOW()
FROM ranked r
WHERE a.id=r.id AND r.rn>1 AND a.status='proposed';

-- Keep absence/participation lifecycle deterministic for future organizations too:
-- later confirmed participation or return resolves earlier unusual-absence signals.
UPDATE aria_observations o
SET status='resolved',
    resolved_at=NOW(),
    updated_at=NOW()
WHERE o.organization_id='org_44497dd8ebdd4767830c8cd193271c09'
  AND o.type='UNUSUAL_ABSENCE'
  AND o.status='active'
  AND EXISTS(
    SELECT 1
    FROM participation_records pr
    WHERE pr.organization_id=o.organization_id
      AND pr.person_id=o.person_id
      AND pr.occurred_at>o.detected_at
  );

UPDATE aria_actions a
SET status='cancelled',
    failure_reason='Superseded by later confirmed participation.',
    updated_at=NOW()
WHERE a.organization_id='org_44497dd8ebdd4767830c8cd193271c09'
  AND a.status='proposed'
  AND a.action_metadata->>'kind'='attendance_absence_check_in'
  AND EXISTS(
    SELECT 1
    FROM participation_records pr
    WHERE pr.organization_id=a.organization_id
      AND pr.person_id=a.person_id
      AND pr.occurred_at>a.proposed_at
  );
