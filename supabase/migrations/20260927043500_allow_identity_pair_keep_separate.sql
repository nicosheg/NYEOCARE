-- Allow human identity separation decisions to be durable.
-- The duplicate-review API already uses keep_separate; the database check must accept it.
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
