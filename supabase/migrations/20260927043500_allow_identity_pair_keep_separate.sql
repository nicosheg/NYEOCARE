-- Persist the allowed human identity separation decision in repository migrations.
ALTER TABLE identity_pair_decisions
  DROP CONSTRAINT IF EXISTS identity_pair_decisions_decision_check;

ALTER TABLE identity_pair_decisions
  ADD CONSTRAINT identity_pair_decisions_decision_check
  CHECK (
    decision = ANY (
      ARRAY[
        'not_duplicate'::text,
        'keep_separate'::text,
        'duplicate_merged'::text,
        'duplicate_verified'::text
      ]
    )
  );
