/**
 * Select identity candidates that are relevant to an edit of an existing person.
 *
 * A phone-only edit should be blocked only by a phone already present on another
 * person in the same organization. A name-only match (especially an archived
 * record with a short/honorific name) is not evidence that the new phone belongs
 * to another person. Name edits retain name-based review; combined name + phone
 * edits retain both checks.
 */
export function candidatesRequiringEditIdentityReview(candidates, { nameChanged = false, phoneChanged = false } = {}) {
  const rows = Array.isArray(candidates) ? candidates : [];
  if (nameChanged && phoneChanged) {
    return rows.filter(candidate => candidate?.phone_match === true || candidate?.name_match === true || candidate?.similar_name === true);
  }
  if (nameChanged) {
    return rows.filter(candidate => candidate?.name_match === true || candidate?.similar_name === true);
  }
  if (phoneChanged) {
    return rows.filter(candidate => candidate?.phone_match === true);
  }
  return [];
}
