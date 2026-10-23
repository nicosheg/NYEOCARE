// lib/aria/serviceIdentity.js
// Prefer a readable service type, then the entered session name. Some older clients store a UUID in service_type;
// that opaque ID must not collapse distinct named services into the same attendance pattern.
export const serviceKeySql = alias => `COALESCE(
  NULLIF(LOWER(BTRIM(REGEXP_REPLACE(
    REGEXP_REPLACE(
      CASE
        WHEN NULLIF(${alias}.service_type,'') IS NOT NULL
         AND NULLIF(${alias}.service_type,'') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN ${alias}.service_type
        ELSE COALESCE(${alias}.name,'')
      END,
      $$\\s*(?:[–—-]\\s*)?(?:\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}|\\d{1,2}[./-]\\d{1,2}(?:[./-]\\d{2,4})?|\\d{1,2}\\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\s+\\d{4})\\s*$$, '', 'i'),
    $$\\s+$$, ' ', 'g'
  ))), ''),
  'weekday:'||EXTRACT(ISODOW FROM ${alias}.started_at)::int::text
)`;