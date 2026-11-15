// lib/personDisplayName.mjs
export function personDisplayName(person = {}) {
  const display = String(person?.display_name || '').trim();
  if (display) return display;

  const core = [person?.first_name, person?.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  const prefix = String(
    person?.honorific || person?.prefix || person?.metadata?.honorific || ''
  ).trim();

  if (prefix) return `${prefix} ${core || 'Unnamed person'}`;
  return core || 'Unnamed person';
}
