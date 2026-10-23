// lib/aria/serviceIdentity.js
// Derives a stable, organization-neutral service key from a configured type or the entered session name.
// A trailing date is stripped so dated session labels still represent the same recurring service.
export const serviceKeySql = alias => `COALESCE(
  NULLIF(LOWER(BTRIM(REGEXP_REPLACE(
    REGEXP_REPLACE(CASE WHEN NULLIF(${alias}.service_type,'') IS NOT NULL AND NULLIF(${alias}.service_type,'') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12},
      $$\\s*(?:[–—-]\\s*)?(?:\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}|\\d{1,2}[./-]\\d{1,2}(?:[./-]\\d{2,4})?|\\d{1,2}\\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\s+\\d{4})\\s*$$, '', 'i'),
    $$\\s+$$, ' ', 'g'
  ))), ''),
  'weekday:'||EXTRACT(ISODOW FROM ${alias}.started_at)::int::text
)`; THEN ${alias}.service_type ELSE COALESCE(${alias}.name,'') END,
      $$\\s*(?:[–—-]\\s*)?(?:\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}|\\d{1,2}[./-]\\d{1,2}(?:[./-]\\d{2,4})?|\\d{1,2}\\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\s+\\d{4})\\s*$$, '', 'i'),
    $$\\s+$$, ' ', 'g'
  ))), ''),
  'weekday:'||EXTRACT(ISODOW FROM ${alias}.started_at)::int::text
)`;