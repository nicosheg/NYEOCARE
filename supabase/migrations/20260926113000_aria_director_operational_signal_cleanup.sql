-- Clean stale ARIA attendance-processing escalations that no longer represent current risk.
-- A completed session or an old orphaned failure event supersedes the proposal.

UPDATE aria_actions a
SET status='cancelled',
    failure_reason='Superseded by later successful processing or expired operational signal.',
    updated_at=NOW()
WHERE a.status='proposed'
  AND a.action_metadata->>'kind'='aria_processing_failure'
  AND (
    EXISTS(
      SELECT 1
      FROM sessions s
      WHERE s.id::text=a.action_metadata->>'session_id'
        AND s.organization_id=a.organization_id
        AND s.aria_processing_status='completed'
    )
    OR EXISTS(
      SELECT 1
      FROM aria_events e
      WHERE e.id::text=a.action_metadata->>'source_event_id'
        AND e.organization_id=a.organization_id
        AND e.processing_status='completed'
        AND e.occurred_at<NOW()-INTERVAL '24 hours'
    )
    OR (
      NOT EXISTS(
        SELECT 1 FROM sessions s
        WHERE s.id::text=a.action_metadata->>'session_id'
          AND s.organization_id=a.organization_id
      )
      AND NOT EXISTS(
        SELECT 1 FROM aria_events e
        WHERE e.id::text=a.action_metadata->>'source_event_id'
          AND e.organization_id=a.organization_id
      )
      AND a.proposed_at<NOW()-INTERVAL '24 hours'
    )
  );

UPDATE aria_observations o
SET status='resolved',
    resolved_at=NOW(),
    updated_at=NOW()
WHERE o.status='active'
  AND o.type='ARIA_PROCESSING_FAILURE'
  AND NOT EXISTS(
    SELECT 1
    FROM aria_actions a
    WHERE a.organization_id=o.organization_id
      AND a.observation_id=o.id
      AND a.status IN('proposed','approved','executing')
  )
  AND o.detected_at<NOW()-INTERVAL '24 hours';
