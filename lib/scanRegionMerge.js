const TITLE_PREFIXES = new Set([
  'sis','sister','bro','brother','mr','mrs','miss','ms','madam','sir','pastor',
  'past','pst','dr','doctor','rev','reverend','elder','deacon','deaconess',
  'chief','bishop','apostle','prophet','minister','evangelist','canon','father',
  'archbishop','mummy','mama','mother','mom','mum','daddy','papa','prof',
  'professor','engr','engineer','barr','barrister','hon','honourable','alhaji',
  'alhaja','mallam','malam','imam','sheikh','sheik','lady','capt','captain',
  'comrade','comr','evang','priest'
]);

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const digits = value => String(value ?? '').replace(/\D/g, '');
const normalize = value => clean(value).toLowerCase().normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z\s'-]/g, ' ')
  .replace(/\s+/g, ' ').trim();

function nameParts(value) {
  const text = normalize(value);
  const tokens = text.split(' ').filter(Boolean);
  if (!tokens.length) return { title: null, titleKnown: true, body: '' };
  if (TITLE_PREFIXES.has(tokens[0])) {
    return { title: tokens[0], titleKnown: true, body: tokens.slice(1).join(' ') };
  }
  // "SB" was repeatedly returned for the handwritten title "SIS" in a real
  // register. Treat this only as a comparison hint, not as a display rewrite.
  if (tokens[0] === 'sb' && tokens.length > 1) {
    return { title: 'sis', titleKnown: false, body: tokens.slice(1).join(' ') };
  }
  return { title: null, titleKnown: true, body: text };
}

function similarity(left, right) {
  const a = normalize(left), b = normalize(right);
  if (!a || !b) return a === b ? 1 : 0;
  if (a === b) return 1;
  if (Math.abs(a.length - b.length) / Math.max(a.length, b.length) > 0.45) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
}

function observationSimilarity(left, right) {
  const a = nameParts(left.name), b = nameParts(right.name);
  const phoneMatch = (left.phones || []).some(p =>
    (right.phones || []).some(q => digits(p) && digits(p) === digits(q))
  );
  if (!a.body || !b.body) return phoneMatch ? 1 : 0;
  // Do not combine people with two different, clearly recognized titles.
  if (a.title && b.title && a.title !== b.title) return 0;
  const bodyScore = similarity(a.body, b.body);
  const fullScore = similarity(left.name, right.name);
  const score = a.title && b.title ? bodyScore : Math.max(bodyScore, fullScore);
  return phoneMatch ? Math.max(score, 1) : score;
}

function titleQuality(value) {
  const first = normalize(value).split(' ')[0];
  if (TITLE_PREFIXES.has(first)) return 2;
  if (first === 'sb') return 1;
  return 0;
}

function chooseName(current, incoming) {
  if (!incoming) return current || '';
  if (!current) return incoming;
  const currentQuality = titleQuality(current), incomingQuality = titleQuality(incoming);
  if (incomingQuality > currentQuality) return incoming;
  if (currentQuality > incomingQuality) return current;
  return incoming.length > current.length ? incoming : current;
}

function mergeObservation(target, incoming) {
  const chosen = chooseName(target.name, incoming.name);
  if (chosen) target.name = chosen;
  target.y = (target.y + incoming.y) / 2;
  for (const phone of incoming.phones || []) {
    if (!target.phones.some(existing => digits(existing) === digits(phone))) {
      target.phones.push(phone);
    }
  }
  target.phones = target.phones.slice(0, 2);
  if (incoming.dob && target.dob && incoming.dob !== target.dob) {
    target.flags.push('dob_uncertain');
  } else if (incoming.dob && !target.dob) {
    target.dob = incoming.dob;
  }
  target.flags.push(...(incoming.flags || []));
  target.e = [target.e, incoming.e].filter(Boolean).join('; ');
  target.regions = [...new Set([...target.regions, ...incoming.regions])];
}

function alignOverlapRows(topRows, bottomRows, maxDistance) {
  const n = topRows.length, m = bottomRows.length;
  const cost = Array.from({ length: n + 1 }, () => Array(m + 1).fill(Infinity));
  const move = Array.from({ length: n + 1 }, () => Array(m + 1).fill(null));
  const GAP = 0.55;
  cost[0][0] = 0;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      const base = cost[i][j];
      if (!Number.isFinite(base)) continue;
      if (i < n && base + GAP < cost[i + 1][j]) {
        cost[i + 1][j] = base + GAP;
        move[i + 1][j] = 'top';
      }
      if (j < m && base + GAP < cost[i][j + 1]) {
        cost[i][j + 1] = base + GAP;
        move[i][j + 1] = 'bottom';
      }
      if (i < n && j < m) {
        const distance = Math.abs(topRows[i].y - bottomRows[j].y);
        const score = observationSimilarity(topRows[i], bottomRows[j]);
        if (distance <= maxDistance && score >= 0.76) {
          const pairCost = (1 - score) * 3 + (distance / maxDistance) * 0.9;
          if (base + pairCost < cost[i + 1][j + 1]) {
            cost[i + 1][j + 1] = base + pairCost;
            move[i + 1][j + 1] = 'match';
          }
        }
      }
    }
  }

  const pairs = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const step = move[i][j];
    if (step === 'match') {
      pairs.push([topRows[i - 1], bottomRows[j - 1]]);
      i--; j--;
    } else if (step === 'top') {
      i--;
    } else if (step === 'bottom') {
      j--;
    } else {
      break;
    }
  }
  return pairs.reverse();
}

export function mergeScanRegions(parts, pageH, maxRows = 50) {
  const all = [];
  const byPart = [];
  for (let partIndex = 0; partIndex < parts.length; partIndex++) {
    const part = parts[partIndex];
    const rows = [];
    for (const person of part.people || []) {
      const y = part.region.y0 +
        (Math.max(0, Math.min(1000, Number(person.y) || 0)) / 1000) *
        (part.region.y1 - part.region.y0);
      const name = clean(person.n);
      const phones = (Array.isArray(person.p) ? person.p : [])
        .map(clean).filter(Boolean).slice(0, 2);
      if (!name && !phones.length) continue;
      const row = {
        y, name, phones, dob: clean(person.dob ?? person.date_of_birth ?? ''),
        flags: Array.isArray(person.f) ? person.f.slice() : [],
        e: clean(person.e), regions: [part.region.id],
        sourcePartIndex: partIndex, dropped: false
      };
      rows.push(row);
      all.push(row);
    }
    rows.sort((a, b) => a.y - b.y);
    byPart.push(rows);
  }

  // Align the row sequences inside each physical overlap. Unlike a nearest-y
  // dedupe, ordered alignment can recover the same row when the two crop reads
  // assign noticeably different vertical centers or slightly different names.
  const margin = Math.min(50, pageH * 0.035);
  const maxDistance = Math.min(95, Math.max(60, pageH * 0.055));
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i].region, b = parts[j].region;
      const overlapStart = Math.max(a.y0, b.y0);
      const overlapEnd = Math.min(a.y1, b.y1);
      if (overlapEnd <= overlapStart) continue;
      const topRows = byPart[i].filter(row =>
        row.y >= overlapStart - margin && row.y <= overlapEnd + margin
      );
      const bottomRows = byPart[j].filter(row =>
        row.y >= overlapStart - margin && row.y <= overlapEnd + margin
      );
      for (const [first, second] of alignOverlapRows(topRows, bottomRows, maxDistance)) {
        if (first.dropped || second.dropped) continue;
        mergeObservation(first, second);
        second.dropped = true;
      }
    }
  }

  const groups = [];
  for (const row of all.filter(item => !item.dropped).sort((a, b) => a.y - b.y)) {
    let hit = null;
    for (const group of groups) {
      const dy = Math.abs(group.y - row.y);
      const sameRegion = group.regions.some(id => row.regions.includes(id));
      if (sameRegion || dy >= Math.max(55, pageH * 0.035)) continue;
      const sameName = normalize(group.name) === normalize(row.name);
      const samePhone = group.phones.some(p =>
        row.phones.some(q => digits(p) && digits(p) === digits(q))
      );
      if (sameName || samePhone) {
        hit = group;
        break;
      }
    }
    if (!hit) {
      groups.push({ ...row, regions: row.regions.slice() });
    } else {
      mergeObservation(hit, row);
    }
  }

  for (let i = 1; i < groups.length; i++) {
    const row = groups[i], previous = groups[i - 1];
    const dy = row.y - previous.y;
    if (!row.name && row.phones.length && previous.name && dy >= 0 &&
        dy < pageH * 0.06 && previous.phones.length < 2) {
      for (const phone of row.phones) {
        if (!previous.phones.some(q => digits(q) === digits(phone))) previous.phones.push(phone);
      }
      previous.flags.push(...row.flags, 'continuation_uncertain');
      previous.e = [previous.e, row.e, 'blank-name continuation line below previous named row']
        .filter(Boolean).join('; ');
      groups.splice(i, 1);
      i--;
    }
  }

  return groups.slice(0, maxRows).map((row, index) => ({
    r: index + 1,
    y: Math.round(row.y / pageH * 1000),
    n: row.name,
    p: row.phones.slice(0, 2),
    dob: row.dob || '',
    f: [...new Set(row.flags)],
    e: row.e
  }));
}
