// lib/aria/serviceIdentity.js
// Derives a stable, organization-neutral service key from a configured type or the entered session name.
// A trailing date is stripped so dated session labels still represent the same recurring service.
export const serviceKeySql = alias => `COALESCE(
  NULLIF(LOWER(BTRIM(REGEXP_REPLACE(
    REGEXP_REPLACE(COALESCE(NULLIF(${alias}.service_type,''), ${alias}.name, ''),
      $$\\s*(?:[–—-]\\s*)?(?:\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}|\\d{1,2}[./-]\\d{1,2}(?:[./-]\\d{2,4})?|\\d{1,2}\\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\s+\\d{4})\\s*$$, '', 'i'),
    $$\\s+$$, ' ', 'g'
  ))), ''),
  'weekday:'||EXTRACT(ISODOW FROM ${alias}.started_at)::int::text
)`;