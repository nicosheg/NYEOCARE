// Bounded, privacy-safe OCR hints derived only from repeated human-reviewed character corrections.
// These cues influence where the vision model looks more carefully; they never rewrite extracted text.
const ALLOWED_TYPES = new Set(['ocr_name_visual_confusion', 'ocr_phone_digit_confusion']);
const ALLOWED_KINDS = new Set(['substitute', 'insert', 'delete']);
const SAFE_CHAR = /^[a-z0-9]$/i;
const MIN_CONFIDENCE = 0.7;
const MIN_EXAMPLES = 2;

function character(value) {
  return typeof value === 'string' && SAFE_CHAR.test(value) ? value.toLowerCase() : '';
}

function cueFor(row) {
  if (!row || !ALLOWED_TYPES.has(row.learning_type)) return null;
  const confidence = Number(row.confidence);
  const examples = Number(row.example_count);
  if (!Number.isFinite(confidence) || confidence < MIN_CONFIDENCE ||
      !Number.isInteger(examples) || examples < MIN_EXAMPLES) return null;

  const value = row.value && typeof row.value === 'object' && !Array.isArray(row.value)
    ? row.value
    : {};
  const kind = String(value.kind || '');
  if (!ALLOWED_KINDS.has(kind)) return null;
  const from = character(value.from);
  const to = character(value.to);
  if (kind === 'substitute' && (!from || !to || from === to)) return null;
  if (kind === 'insert' && (from || !to)) return null;
  if (kind === 'delete' && (!from || to)) return null;

  return {
    field: row.learning_type === 'ocr_name_visual_confusion' ? 'name' : 'phone',
    kind,
    from,
    to,
    examples
  };
}

function describeCue(cue) {
  const prior = cue.from ? `OCR read '${cue.from}'` : 'OCR omitted a character';
  const reviewed = cue.to ? `reviewers confirmed '${cue.to}'` : 'reviewers confirmed no character';
  return `${cue.field}: ${prior}; ${reviewed} (${cue.examples} reviewed cases)`;
}

export function formatScanLearningHints(rows) {
  const source = Array.isArray(rows) ? rows : [];
  const unique = new Map();
  for (const row of source) {
    const cue = cueFor(row);
    if (!cue) continue;
    const key = [cue.field, cue.kind, cue.from, cue.to].join(':');
    const previous = unique.get(key);
    if (!previous || cue.examples > previous.examples) unique.set(key, cue);
  }

  const values = [...unique.values()];
  const nameCues = values.filter(cue => cue.field === 'name')
    .sort((a, b) => b.examples - a.examples);
  const phoneCues = values.filter(cue => cue.field === 'phone')
    .sort((a, b) => b.examples - a.examples);
  // Keep prompt overhead small: up to three name cues and two phone cues.
  const selected = [...nameCues.slice(0, 3), ...phoneCues.slice(0, 2)];
  if (!selected.length) return '';

  return `\n\nHuman-reviewed OCR attention cues (not correction rules): ${selected.map(describeCue).join('; ')}. Reinspect these character shapes in the image. Never substitute a character automatically to match a cue; the current image is the authority. Preserve literal visible text and flag uncertain fields.`;
}
