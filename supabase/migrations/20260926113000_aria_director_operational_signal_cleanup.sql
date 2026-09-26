-- Clean stale ARIA attendance-processing escalations that no longer represent current risk.
-- A completed session or an old orphaned failure event supersedes the proposal.
WITH stale AS (
  SELECT a.id,a.observation_id
  FROM aria_actions a
  LEFT JOIN sessions s
    ON s.id::text=a.action_metadata->>'session_id'
   AND s.organization_id=a.organization_id
  LEFT JOIN aria_events e
    ON e.id::text=a.action_metadata->>'source_event_id'
   AND e.organization_id=a.organization_id
  WHERE a.status='proposed'
    AND a.action_metadata->>'kind'='aria_processing_failure'
    AND (
      (s.id IS NOT NULL AND s.aria_processing_status='completed')
      OR (e.id IS NOT NULL AND e.processing_status='completed' AND e.occurred_at<NOW()-INTERVAL '24 hours')
      OR (s.id IS NULL AND e.id IS NULL AND a.proposed_at<NOW()-INTERVAL '24 hours')
    )
)
UPDATE aria_actions a
SET status='cancelled',
    failure_reason='Superseded by later successful processing or expired operational signal.',
    updated_at=NOW()
WHERE a.id IN (SELECT id FROM stale);

UPDATE aria_observations o
SET status='resolved',
    resolved_at=NOW(),
    updated_at=NOW()
WHERE o.id IN (
  SELECT observation_id
  FROM stale
  WHERE observation_id IS NOT NULL
)
AND o.status='active';
