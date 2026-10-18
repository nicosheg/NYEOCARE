// pages/api/people/bulk-create.js
import pool from '../../../lib/db';
import { waitUntil } from '@vercel/functions';
import { normalizePhone } from '../../../lib/phoneUtils';
import { normalizeDisplayName } from '../../../lib/scanValidation';
import { withOrg } from '../../../lib/apiHelpers';
import { emitAriaEvent } from '../../../lib/aria/eventEmitter';
import { directAriaEvent } from '../../../lib/aria/director';

const MAX_ROWS = 200;

function splitName(value) {
  const normalized = normalizeDisplayName(value);
  const parts = normalized.core.split(/\s+/).filter(Boolean);
  return {
    first_name: parts.shift() || '',
    last_name: parts.join(' '),
    display_name: normalized.display
  };
}

function rowNumber(row, index) {
  const value = Number(row?.row_number);
  return Number.isInteger(value) && value > 0 ? value : index + 1;
}

async function processCreatedPeople(people, organizationId, actorId, actorRole) {
  // ARIA enrichment is deliberately outside the synchronous insert path.
  // The people records are already committed before this background work starts.
  for (let offset = 0; offset < people.length; offset += 4) {
    const batch = people.slice(offset, offset + 4);
    await Promise.allSettled(batch.map(async person => {
      try {
        const event = await emitAriaEvent({
          organizationId,
          personId: person.id,
          type: 'PERSON_CREATED',
          source: 'manual',
          actorId,
          actorRole,
          metadata: { source: 'bulk_add' },
          eventKey: `manual:${organizationId}:person:${person.id}:created`
        });
        if (event) await directAriaEvent(event);
      } catch (error) {
        console.error('[PEOPLE_BULK] ARIA enrichment failed:', {
          person_id: person.id,
          message: error?.message || String(error)
        });
      }
    }));
  }
}

export default withOrg(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!['owner', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Admin permissions required.' });
  }

  const body = req.body || {};
  const rawRows = body.rows;
  const defaultType = String(body.default_type || 'visitor').trim().toLowerCase();
  if (!['member', 'visitor'].includes(defaultType)) {
    return res.status(400).json({ error: 'Default type must be member or visitor.' });
  }
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    return res.status(400).json({ error: 'Paste at least one person row.' });
  }
  if (rawRows.length > MAX_ROWS) {
    return res.status(400).json({ error: `Add up to ${MAX_ROWS} people per batch.`, max_rows: MAX_ROWS });
  }

  const results = rawRows.map((raw, index) => {
    const row = raw && typeof raw === 'object' ? raw : {};
    const name = String(row.full_name ?? row.name ?? '').trim();
    const phoneText = String(row.phone ?? '').trim();
    const email = String(row.email ?? '').trim().toLowerCase();
    const type = String(row.type || defaultType).trim().toLowerCase();
    const line = rowNumber(row, index);
    const sourceLines = Array.isArray(row.source_line_numbers) ? row.source_line_numbers.map(Number).filter(value => Number.isInteger(value) && value > 0) : [line];
    const outcome = { row: line, source_line_numbers: sourceLines.length ? sourceLines : [line], name, status: 'skipped', reason: '' };

    if (!name) {
      outcome.reason = 'Name is required.';
      return { outcome, candidate: null };
    }
    if (name.length > 150) {
      outcome.reason = 'Name must be 150 characters or fewer.';
      return { outcome, candidate: null };
    }
    const split = splitName(name);
    if (!split.first_name || split.first_name.length > 150 || split.last_name.length > 150) {
      outcome.reason = 'Please enter a valid name (up to 150 characters per name part).';
      return { outcome, candidate: null };
    }
    const phone = phoneText ? normalizePhone(phoneText) : null;
    if (phoneText && !phone) {
      outcome.reason = 'Phone number is incomplete or invalid. Use a complete number, such as 08012345678.';
      return { outcome, candidate: null };
    }
    if (!['member', 'visitor'].includes(type)) {
      outcome.reason = 'Type must be member or visitor.';
      return { outcome, candidate: null };
    }
    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      outcome.reason = 'Email address is invalid.';
      return { outcome, candidate: null };
    }

    return {
      outcome,
      candidate: {
        index,
        ...split,
        phone,
        email: email || null,
        type,
        birthday: null,
        living_truth: JSON.stringify({
          status: 'alive',
          confidence: 90,
          source: 'canonical_record',
          updated_at: new Date().toISOString()
        })
      }
    };
  });

  // Keep the first valid instance of a phone number in the pasted list.
  const seenPhones = new Map();
  const candidates = [];
  for (const item of results) {
    const candidate = item.candidate;
    if (!candidate) continue;
    if (candidate.phone && seenPhones.has(candidate.phone)) {
      item.outcome.reason = `Phone number duplicates row ${seenPhones.get(candidate.phone)} in this list.`;
      item.candidate = null;
      continue;
    }
    if (candidate.phone) seenPhones.set(candidate.phone, item.outcome.row);
    candidates.push(candidate);
  }

  const organizationId = req.org.id;
  const client = await pool.connect();
  let insertedPeople = [];
  try {
    await client.query('BEGIN');
    // Avoid two simultaneous bulk submissions racing each other through the duplicate check.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`people-bulk-create:${organizationId}`]);

    const phones = candidates.map(row => row.phone).filter(Boolean);
    const existingByPhone = new Map();
    if (phones.length) {
      const existing = await client.query(
        `SELECT p.id, p.display_name, p.phone, p.phone_numbers
         FROM people p
         WHERE p.organization_id=$1
           AND COALESCE(p.status,'active')='active'
           AND COALESCE(p.living_truth->>'status','alive') NOT IN ('needs_decision','conflict')
           AND (
             p.phone=ANY($2::text[])
             OR EXISTS (
               SELECT 1
               FROM jsonb_array_elements(COALESCE(p.phone_numbers,'[]'::jsonb)) v
               WHERE v->>'normalized'=ANY($2::text[])
             )
           )`,
        [organizationId, phones]
      );
      for (const person of existing.rows) {
        const phonesOnPerson = [
          person.phone,
          ...(Array.isArray(person.phone_numbers)
            ? person.phone_numbers.flatMap(value => [value?.normalized, value?.raw, value?.phone])
            : [])
        ];
        for (const rawPhone of phonesOnPerson) {
          const normalized = normalizePhone(rawPhone);
          if (normalized) existingByPhone.set(normalized, person);
        }
      }
    }

    const accepted = [];
    for (const item of results) {
      const candidate = item.candidate;
      if (!candidate) continue;
      const existing = candidate.phone ? existingByPhone.get(candidate.phone) : null;
      if (existing) {
        item.outcome.reason = `Phone already belongs to ${existing.display_name || existing.phone || 'another person'}.`;
        item.candidate = null;
        continue;
      }
      accepted.push(candidate);
    }

    if (accepted.length) {
      const values = [organizationId];
      const groups = accepted.map(row => {
        const first = values.length + 1;
        values.push(
          row.first_name, row.last_name, row.display_name || null,
          row.phone, row.email, row.type, row.birthday, req.user.id, row.living_truth
        );
        return `($1,$${first},$${first + 1},$${first + 2},$${first + 3},$${first + 4},$${first + 5},$${first + 6},$${first + 7},$${first + 8}::jsonb,'active','manual')`;
      });
      const created = await client.query(
        `INSERT INTO people
          (organization_id,first_name,last_name,display_name,phone,email,type,birthday,created_by,living_truth,status,source)
         VALUES ${groups.join(',')}
         RETURNING id,first_name,last_name,display_name,phone,email,type,birthday,created_at`,
        values
      );
      insertedPeople = created.rows;
      for (const candidate of accepted) results[candidate.index].outcome.status = 'created';
    }

    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[PEOPLE_BULK] Insert failed:', error?.message || error);
    return res.status(500).json({ error: 'Could not add people. Nothing from this batch was saved.' });
  } finally {
    client.release();
  }

  if (insertedPeople.length) {
    try {
      waitUntil(processCreatedPeople(insertedPeople, organizationId, req.user.id, req.user.role));
    } catch (error) {
      console.error('[PEOPLE_BULK] Could not schedule ARIA enrichment:', error?.message || error);
    }
  }

  const skipped = results.filter(item => item.outcome.status !== 'created');
  return res.status(200).json({
    success: true,
    created: insertedPeople.length,
    skipped: skipped.length,
    max_rows: MAX_ROWS,
    results: results.map(item => item.outcome)
  });
});
