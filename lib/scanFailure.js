// lib/scanFailure.js
// Phase 1 scan failure persistence. The database client is injected so failure paths
// can be tested deterministically without a live database or provider.
const ACTIVE_STATUSES = new Set(['pending', 'processing', 'retrying']);
const ALLOWED_STAGES = new Set([
  'admission', 'image_prep', 'region_read', 'validate', 'merge',
  'identity_match', 'persist', 'resume', 'unknown'
]);
const STAGE_ALIASES = {
  ai_request: 'region_read',
  reading_page: 'region_read',
  reading_overlapping_regions: 'region_read',
  parse_json: 'validate',
  validating_extraction: 'validate',
  resolving_identity: 'identity_match',
  database_save: 'persist',
  database_error: 'persist',
  scan: 'unknown'
};
const text = (value, max = 500) => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, max);
const numberOrNull = value => Number.isFinite(Number(value)) ? Number(value) : null;
const parseJson = value => {
  if (value && typeof value === 'object') return value;
  try { return value ? JSON.parse(value) : null; } catch { return null; }
};

export function normalizeScanFailureStage(stage) {
  const value = String(stage || 'unknown').trim().toLowerCase();
  const normalized = STAGE_ALIASES[value] || value;
  return ALLOWED_STAGES.has(normalized) ? normalized : 'unknown';
}

function classifyFailure(code, detail = {}) {
  const value = String(code || '').toUpperCase();
  if (value === 'AI_RATE_LIMIT') return 'rate_limit';
  if (value === 'AI_TIMEOUT') return 'timeout';
  if (value === 'AI_OUTPUT_TRUNCATED') return 'output_truncated';
  if (value === 'AI_INVALID_RESPONSE' || value === 'EMPTY_AI_RESPONSE' || value === 'AI_EMPTY_REGION') return 'invalid_response';
  if (value === 'AI_MODEL_UNAVAILABLE') return 'model_unavailable';
  if (value === 'INVALID_IMAGE' || value === 'IMAGE_PREP') return 'image_prep';
  if (value === 'PERSIST_FAILED' || value === 'DB_TERMINAL_WRITE') return 'database_failure';
  if (Number(detail.status ?? detail.http_status) === 400) return 'provider_rejection';
  if (value === 'AI_PROVIDER_ERROR') return 'provider_error';
  if (value === 'SCAN_STALLED') return 'worker_stalled';
  return 'scan_failure';
}

function safeFailureDetail(code, stage, detail = {}, regionStates = null) {
  const source = detail && typeof detail === 'object' ? detail : { message: detail };
  return {
    failure_class: text(source.failure_class || classifyFailure(code, source), 80),
    source_code: text(source.code, 100) || null,
    stage,
    message: text(source.providerMessage || source.message || source.userMessage || code, 500),
    provider: text(source.provider, 80) || null,
    provider_model: text(source.providerModel || source.provider_model || source.model, 120) || null,
    provider_status: numberOrNull(source.status ?? source.providerStatus ?? source.http_status),
    request_id: text(source.requestId || source.request_id, 160) || null,
    attempt: numberOrNull(source.attempt),
    finish_reason: text(source.finish_reason || source.finishReason, 80) || null,
    retry_after_seconds: numberOrNull(source.retryDelaySeconds ?? source.retry_after_seconds ?? source.retryAfter),
    cooldown_seconds: numberOrNull(source.cooldownSeconds ?? source.cooldown_seconds),
    scan_pipeline_version: text(source.scan_pipeline_version || source.pipeline_version, 120) || null,
    region_states: regionStates
  };
}

function safeProgressDetail(value, stage, code, now) {
  const previous = parseJson(value);
  return {
    ...(previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {}),
    stage: 'failed',
    status: 'failed',
    failed_stage: stage,
    error_code: code,
    updated_at: now.toISOString()
  };
}

function elapsedMs(startTime, row, now) {
  const start = Number(startTime) || (row?.started_at ? new Date(row.started_at).getTime() : 0) ||
    (row?.created_at ? new Date(row.created_at).getTime() : 0);
  return start ? Math.max(0, now.getTime() - start) : null;
}

/**
 * Attempt a fully detailed terminal update, then use a deliberately minimal fallback.
 * The fallback SQL only changes status and error_code so it cannot repeat a JSONB binding
 * or depend on Phase 1 columns being present during a staggered deployment.
 */
export async function persistScanFailure(db, options = {}) {
  const jobId = options.jobId;
  const stage = normalizeScanFailureStage(options.stage);
  const code = text(options.code || 'SCAN_FAILED', 100);
  const now = options.now instanceof Date ? options.now : new Date();
  let before = null;
  try {
    const current = await db.query(
      'SELECT id, organization_id, status, progress_detail, created_at, started_at FROM public.scan_jobs WHERE id = $1 LIMIT 1',
      [jobId]
    );
    before = current.rows?.[0] || null;
  } catch (error) {
    // A failed read must not stop the terminal update attempt.
    console.error('[SCAN_FAILURE] Could not read the current job before failure recording:', text(error?.message, 300));
  }

  if (before && !ACTIVE_STATUSES.has(String(before.status))) {
    return { transitioned: false, alreadyTerminal: true, persistenceFailed: false, usedFallback: false, job: before, priorProgressDetail: parseJson(before.progress_detail), stage, code };
  }

  const previousProgress = parseJson(before?.progress_detail);
  const regionStates = previousProgress && typeof previousProgress === 'object'
    ? {
        stage: text(previousProgress.stage || before?.status, 80) || null,
        regions_total: numberOrNull(previousProgress.regions_total),
        regions_completed: numberOrNull(previousProgress.regions_completed),
        active_region: numberOrNull(previousProgress.active_region)
      }
    : null;
  const failureDetail = safeFailureDetail(code, stage, options.detail, regionStates);
  const result = options.result == null
    ? { error: { stage, code, message: failureDetail.message, userMessage: 'ARIA could not safely complete this scan. Nothing was changed.' } }
    : options.result;
  const duration = elapsedMs(options.startTime, before, now);
  const progressDetail = safeProgressDetail(before?.progress_detail, stage, code, now);
  const priorProgressJson = JSON.stringify(progressDetail);
  const detailJson = JSON.stringify(failureDetail);
  const resultJson = JSON.stringify(result);
  const errorMessage = text(failureDetail.message || code, 500);

  try {
    const updated = await db.query(
      `UPDATE public.scan_jobs
       SET status = 'failed',
           progress = 'failed',
           failed_stage = $2,
           error_code = $3,
           error_detail = $4::jsonb,
           progress_detail = $5::jsonb,
           heartbeat = $6,
           heartbeat_at = $6,
           last_progress_at = $6,
           completed_at = $6,
           duration_ms = $7,
           attempt_count = GREATEST(attempt_count, $8),
           provider_used = COALESCE($9, provider_used),
           error_message = $10,
           result = $11::jsonb
       WHERE id = $1
         AND status IN ('pending', 'processing', 'retrying')
       RETURNING id, organization_id, status, progress_detail, created_at, started_at, completed_at, duration_ms`,
      [jobId, stage, code, detailJson, priorProgressJson, now, duration,
        Math.max(0, Math.floor(Number(options.attemptCount) || 0)), text(options.provider, 80) || null,
        errorMessage, resultJson]
    );
    if (updated.rows?.length) {
      return { transitioned: true, alreadyTerminal: false, persistenceFailed: false, usedFallback: false, job: updated.rows[0], priorProgressDetail: previousProgress, stage, code, detail: failureDetail, elapsedMs: duration };
    }
    return { transitioned: false, alreadyTerminal: true, persistenceFailed: false, usedFallback: false, job: before, priorProgressDetail: previousProgress, stage, code, detail: failureDetail, elapsedMs: duration };
  } catch (fullError) {
    console.error('[SCAN_FAILURE] Full terminal write failed; attempting minimal fallback:', text(fullError?.message, 500));
  }

  try {
    const fallback = await db.query(
      `UPDATE public.scan_jobs SET status = 'failed', error_code = $2
       WHERE id = $1 AND status IN ('pending', 'processing', 'retrying')
       RETURNING id, organization_id, status, created_at, started_at`,
      [jobId, code]
    );
    if (fallback.rows?.length) {
      console.error('[SCAN_FAILURE] Minimal terminal-state fallback recorded the failed job:', text(jobId, 80), code);
      return { transitioned: true, alreadyTerminal: false, persistenceFailed: false, usedFallback: true, job: fallback.rows[0], priorProgressDetail: previousProgress, stage, code, detail: failureDetail, elapsedMs: duration };
    }
    return { transitioned: false, alreadyTerminal: true, persistenceFailed: false, usedFallback: true, job: before, priorProgressDetail: previousProgress, stage, code, detail: failureDetail, elapsedMs: duration };
  } catch (fallbackError) {
    console.error('[SCAN_FAILURE] CRITICAL: both terminal-state writes failed:', text(fallbackError?.message, 500), 'job=', text(jobId, 80), 'code=', code);
    return { transitioned: false, alreadyTerminal: false, persistenceFailed: true, usedFallback: true, job: before, priorProgressDetail: previousProgress, stage, code, detail: failureDetail, elapsedMs: duration };
  }
}

function stateText(regionStates) {
  if (!regionStates || !Number.isFinite(Number(regionStates.regions_total)) || Number(regionStates.regions_total) < 1) return 'not reported';
  return `${Math.max(0, Number(regionStates.regions_completed) || 0)}/${Number(regionStates.regions_total)} regions complete${regionStates.active_region ? `; active region ${regionStates.active_region}` : ''}`;
}

async function telegramSend(message, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { sent: false, disabled: true, reason: 'TELEGRAM_NOT_CONFIGURED' };
  if (typeof fetchImpl !== 'function') return { sent: false, disabled: false, reason: 'FETCH_UNAVAILABLE' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: true }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Telegram returned HTTP ${response.status}`);
    return { sent: true };
  } catch (error) {
    return { sent: false, disabled: false, reason: text(error?.message || error, 300) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Bounded, privacy-conscious, deduplicated Telegram alerting. It never throws.
 * When more than five failures of the same code occur in one ten-minute window,
 * job alerts are suppressed and only one summary alert is sent for that code/window.
 */
export async function sendScanFailureAlert(db, options = {}) {
  const jobId = options.jobId || options.job?.id || null;
  const orgId = options.organizationId || options.job?.organization_id || null;
  const code = text(options.code || 'SCAN_FAILED', 100);
  const stage = normalizeScanFailureStage(options.stage);
  const now = options.now instanceof Date ? options.now : new Date();
  const startMs = Math.floor(now.getTime() / 600000) * 600000;
  const windowStart = new Date(startMs);
  const windowEnd = new Date(startMs + 600000);
  const regionStates = options.regionStates || null;
  const elapsed = numberOrNull(options.elapsedMs);

  try {
    const env = options.env || process.env;
    const tokenAvailable = Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
    if (!tokenAvailable) {
      console.error('[SCAN_FAILURE_ALERT] Telegram is not configured; set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID. Failed job:', text(jobId, 80), code);
      return { sent: false, reason: 'TELEGRAM_NOT_CONFIGURED' };
    }

    let count = 1;
    try {
      const countResult = await db.query(
        `SELECT COUNT(*)::int AS count
         FROM public.scan_jobs
         WHERE status = 'failed'
           AND error_code = $1
           AND COALESCE(completed_at, created_at) >= $2
           AND COALESCE(completed_at, created_at) < $3`,
        [code, windowStart, windowEnd]
      );
      count = Math.max(1, Number(countResult.rows?.[0]?.count) || 1);
    } catch (error) {
      console.error('[SCAN_FAILURE_ALERT] Could not aggregate failures; sending an individual alert:', text(error?.message, 300));
    }

    const alertType = count > 5 ? 'suppressed' : 'single';
    const ledger = await db.query(
      `INSERT INTO public.scan_failure_alerts
       (job_id, organization_id, error_code, failed_stage, region_states, elapsed_ms, alert_type, window_start, delivery_status)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
       ON CONFLICT (job_id) DO NOTHING
       RETURNING id`,
      [jobId, orgId, code, stage, JSON.stringify(regionStates), elapsed, alertType, windowStart, alertType === 'single' ? 'pending' : 'suppressed']
    );
    if (!ledger.rows?.length) return { sent: false, reason: 'ALREADY_RECORDED' };
    let alertRowId = ledger.rows[0].id;

    let message;
    if (count > 5) {
      const summary = await db.query(
        `INSERT INTO public.scan_failure_alerts
         (job_id, organization_id, error_code, failed_stage, region_states, elapsed_ms, alert_type, window_start, delivery_status)
         VALUES (NULL, $1, $2, $3, $4::jsonb, $5, 'summary', $6, 'pending')
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [orgId, code, stage, JSON.stringify(regionStates), elapsed, windowStart]
      );
      if (!summary.rows?.length) return { sent: false, reason: 'SUMMARY_ALREADY_SENT' };
      alertRowId = summary.rows[0].id;
      message = `NYEOCARE scan alert summary: ${code} ×${count} in this 10-minute window. Latest job ${text(jobId, 80)}; organization ${text(orgId, 80) || 'unknown'}; stage ${stage}; ${stateText(regionStates)}; elapsed ${elapsed == null ? 'unknown' : `${Math.round(elapsed / 1000)}s`}.`;
    } else {
      message = `NYEOCARE scan failed. Job: ${text(jobId, 80) || 'unknown'}; organization: ${text(orgId, 80) || 'unknown'}; stage: ${stage}; code: ${code}; regions: ${stateText(regionStates)}; elapsed: ${elapsed == null ? 'unknown' : `${Math.round(elapsed / 1000)}s`}.`;
    }

    const delivery = await telegramSend(message, { env, fetchImpl: options.fetchImpl });
    if (delivery.sent) {
      await db.query(
        'UPDATE public.scan_failure_alerts SET delivery_status = \'sent\', sent_at = $2, delivery_error = NULL WHERE id = $1',
        [alertRowId, now]
      );
      return { sent: true, alertType: count > 5 ? 'summary' : 'single' };
    }

    const status = delivery.disabled ? 'disabled' : 'failed';
    await db.query(
      'UPDATE public.scan_failure_alerts SET delivery_status = $2, delivery_error = $3 WHERE id = $1',
      [alertRowId, status, text(delivery.reason, 500)]
    );
    console.error('[SCAN_FAILURE_ALERT] Could not deliver scan alert:', delivery.reason, 'job=', text(jobId, 80), 'code=', code);
    return { sent: false, reason: delivery.reason };
  } catch (error) {
    // Alerting is deliberately fail-safe: it must not throw into or replace scan failure handling.
    console.error('[SCAN_FAILURE_ALERT] Alerting failed without changing the scan outcome:', text(error?.message || error, 500), 'job=', text(jobId, 80), 'code=', code);
    return { sent: false, reason: text(error?.message || error, 300) };
  }
}

export async function recordScanFailureAndAlert(db, options = {}) {
  let persisted;
  try {
    persisted = await persistScanFailure(db, options);
  } catch (error) {
    // Defensive outer guard: this utility's public contract is never-throw.
    console.error('[SCAN_FAILURE] Unexpected failure-recording exception:', text(error?.message || error, 500), 'job=', text(options.jobId, 80));
    persisted = {
      transitioned: false,
      persistenceFailed: true,
      usedFallback: true,
      job: null,
      priorProgressDetail: null,
      stage: normalizeScanFailureStage(options.stage),
      code: text(options.code || 'SCAN_FAILED', 100),
      detail: safeFailureDetail(options.code, normalizeScanFailureStage(options.stage), options.detail),
      elapsedMs: elapsedMs(options.startTime, null, options.now instanceof Date ? options.now : new Date())
    };
  }

  // Notify after terminal persistence has been attempted. A failed DB write still alerts.
  if (persisted.transitioned || persisted.persistenceFailed) {
    const previous = persisted.priorProgressDetail && typeof persisted.priorProgressDetail === 'object'
      ? persisted.priorProgressDetail : {};
    const regionStates = {
      stage: text(previous.stage, 80) || null,
      regions_total: numberOrNull(previous.regions_total),
      regions_completed: numberOrNull(previous.regions_completed),
      active_region: numberOrNull(previous.active_region)
    };
    await sendScanFailureAlert(db, {
      jobId: options.jobId,
      organizationId: persisted.job?.organization_id || options.organizationId || null,
      stage: persisted.stage,
      code: persisted.code,
      regionStates,
      elapsedMs: persisted.elapsedMs,
      now: options.now,
      env: options.env,
      fetchImpl: options.fetchImpl
    });
  }
  return persisted;
}
