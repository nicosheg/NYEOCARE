// lib/bulkPeopleParser.mjs
const PERSON_TYPES = new Set(['member', 'visitor']);

function isType(value) {
  return PERSON_TYPES.has(String(value || '').trim().toLowerCase());
}

function isEmailLike(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function isPhoneLike(value) {
  const raw = String(value || '').trim();
  if (!raw || !/^\+?[\d\s().-]+$/.test(raw)) return false;
  return raw.replace(/\D/g, '').length >= 3;
}

function isHeader(columns) {
  const first = String(columns[0] || '').trim().toLowerCase();
  const second = String(columns[1] || '').trim().toLowerCase();
  return /^(full\s+name|name|person)$/.test(first) &&
    (/phone|mobile|telephone/.test(second) || /^(type|email)$/.test(second));
}

function isCommaSeparatedNameList(columns) {
  const values = columns.map(value => String(value || '').trim()).filter(Boolean);
  if (values.length < 2) return false;
  return !columns.slice(1).some(value => isPhoneLike(value) || isEmailLike(value) || isType(value));
}

function createRow(name, phone, type, email, sourceLines, sourceRowKey, defaultType, rowNumber) {
  return {
    full_name: String(name || '').trim(),
    phone: String(phone || '').trim(),
    type: String(type || defaultType || 'visitor').trim().toLowerCase(),
    email: String(email || '').trim(),
    row_number: rowNumber,
    source_line_numbers: [...new Set(sourceLines)],
    source_row_key: sourceRowKey
  };
}

function parseStructuredColumns(columns, sourceLine, sourceRowKey, defaultType, rowNumber) {
  const name = String(columns[0] || '').trim();
  let phone = String(columns[1] || '').trim();
  let type = String(columns[2] || '').trim().toLowerCase();
  let email = String(columns[3] || '').trim();

  // Accept compact "Name, member" and "Name, email@example.com" rows too.
  if (isType(phone) && !type) {
    type = phone.toLowerCase();
    phone = '';
  } else if (isEmailLike(phone) && !type && !email) {
    email = phone;
    phone = '';
  }

  return createRow(name, phone, type, email, [sourceLine], sourceRowKey, defaultType, rowNumber);
}

/**
 * Accepts:
 * - one name per line;
 * - comma-separated name-only lists;
 * - tab, pipe, or comma separated Name / Phone / Type / Email rows;
 * - alternating name-then-phone lines.
 *
 * A comma-only line with no phone, email, or recognised person type is treated
 * as a list of names. Use tabs or pipes when a person's own name contains a comma.
 */
export function parseBulkPeopleRows(input, defaultType = 'visitor') {
  const lines = String(input || '').split(/\r?\n/);
  const prepared = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const sourceLine = index + 1;
    if (!line || line.startsWith('#')) continue;

    if (isPhoneLike(line)) {
      const previous = prepared[prepared.length - 1];
      if (previous && previous.kind === 'plain' && !previous.phone) {
        previous.phone = line;
        previous.source_line_numbers.push(sourceLine);
      }
      continue;
    }

    prepared.push({
      line,
      kind: line.includes('\t') || line.includes('|') || line.includes(',') ? 'delimited' : 'plain',
      phone: '',
      source_line_numbers: [sourceLine],
      source_line: sourceLine
    });
  }

  const rows = [];
  const push = (row) => rows.push({ ...row, row_number: rows.length + 1 });

  for (const item of prepared) {
    const line = item.line.trim();
    if (!line) continue;

    if (line.includes('\t') || line.includes('|')) {
      const delimiter = line.includes('\t') ? '\t' : '|';
      const columns = line.split(delimiter);
      if (isHeader(columns)) continue;
      push(parseStructuredColumns(
        columns,
        item.source_line,
        String(item.source_line) + ':1',
        defaultType,
        rows.length + 1
      ));
      continue;
    }

    if (line.includes(',')) {
      const columns = line.split(',').map(value => String(value || '').trim());
      if (isHeader(columns)) continue;

      if (isCommaSeparatedNameList(columns)) {
        let part = 0;
        for (const name of columns) {
          const cleanName = String(name || '').trim();
          if (!cleanName) continue;
          part += 1;
          push(createRow(
            cleanName,
            '',
            defaultType,
            '',
            [item.source_line],
            String(item.source_line) + ':' + String(part),
            defaultType,
            rows.length + 1
          ));
        }
      } else {
        push(parseStructuredColumns(
          columns,
          item.source_line,
          String(item.source_line) + ':1',
          defaultType,
          rows.length + 1
        ));
      }
      continue;
    }

    let remainder = line;
    let type = defaultType;
    const typeMatch = remainder.match(/\s+(member|visitor)\s*$/i);
    if (typeMatch) {
      type = typeMatch[1].toLowerCase();
      remainder = remainder.slice(0, typeMatch.index).trim();
    }

    let phone = item.phone || '';
    if (!phone) {
      const phoneMatch = remainder.match(/(?:\+?[\d][\d\s().-]{1,}\d)\s*$/);
      if (phoneMatch && isPhoneLike(phoneMatch[0])) {
        phone = phoneMatch[0].trim();
        remainder = remainder.slice(0, phoneMatch.index).replace(/[\s|,;:-]+$/, '').trim();
      }
    }

    const name = remainder;
    if (/^(full\s+name|name|person)$/i.test(name)) continue;

    push(createRow(
      name,
      phone,
      type,
      '',
      item.source_line_numbers,
      String(item.source_line) + ':1',
      defaultType,
      rows.length + 1
    ));
  }

  return rows;
}
