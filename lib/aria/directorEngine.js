// lib/aria/directorEngine.js
//
// Canonical organizational intelligence for ARIA.
// Deterministic reconciliation happens here before any model is asked to speak.

import pool from '../db';
import { getPriorityQueue } from './priorityQueue';

export const ARIA_DIRECTOR_CORE_VERSION = '4.0.0';

const n = (v, d=0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};

const nameOf = row =>
  row?.display_name ||
  [row?.first_name, row?.last_name].filter(Boolean).join(' ').trim() ||
  'Someone';

function pct(v) {
  return Math.round(n(v, 0));
}

function daysBetween(a, b=new Date()) {
  if(!a) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

function evidenceLine(statement, source, confidence=.95) {
  return {
    statement: String(statement || '').slice(0, 900),
    source,
    confidence: Math.max(0, Math.min(1, n(confidence, .5)))
  };
}

function signalClass(signal) {
  const type = String(signal?.signal_type || '');
  if(['extended_absence','emerging_attendance_decline','active_signal'].includes(type)) return 'human_care';
  if(['new_relationship','belonging_opportunity','recognition_opportunity','contribution_opportunity'].includes(type)) return 'organization_opportunity';
  if(type === 'pending_action') return 'human_care';
  return 'watch';
}

function signalFresh(signal) {
  const date = signal?.observation_detected_at || signal?.last_attendance;
  return !date || daysBetween(date) <= 30;
}

function reconcileAttendanceCandidate(candidate) {
  const lifecycle = String(candidate.lifecycle_state || '');
  const count = n(candidate.participation_count);
  const trend = n(candidate.trend);
  const deviation = n(candidate.deviation);

  if(candidate.signal_type === 'emerging_attendance_decline' && lifecycle === 'onboarding') {
    return {
      classification: 'new_relationship_watch',
      reason: 'Participation is below a previous reference pattern, but the relationship is still new. ARIA will not treat that alone as disengagement.'
    };
  }

  if(candidate.signal_type === 'extended_absence' && count <= 1) {
    return {
      classification: 'first_or_early_absence',
      reason: 'The absence is only a light signal because there is not yet enough personal history for a strong pattern claim.'
    };
  }

  if(candidate.signal_type === 'emerging_attendance_decline' && Math.max(Math.abs(trend), Math.abs(deviation)) < .35) {
    return {
      classification: 'weak_pattern',
      reason: 'The attendance change is visible but not strong enough to treat as a confirmed decline.'
    };
  }

  return {
    classification: candidate.signal_type || 'signal',
    reason: candidate.reason || 'ARIA found a meaningful change worth reviewing.'
  };
}

async function loadCore(orgId) {
  const [population,sessions,knowledge,operations,observations,actions,feedback,queue,recentSignals,orgMemory] = await Promise.all([
    pool.query(
      "SELECT COUNT(*)::int people,MIN(created_at) first_person_at,MAX(created_at) latest_person_at," +
      "COUNT(*) FILTER(WHERE created_at>=NOW()-INTERVAL '7 days')::int people_7d," +
      "COUNT(*) FILTER(WHERE created_at>=NOW()-INTERVAL '14 days' AND created_at<NOW()-INTERVAL '7 days')::int people_prev_7d," +
      "COUNT(*) FILTER(WHERE LOWER(COALESCE(type,''))='member')::int members," +
      "COUNT(*) FILTER(WHERE LOWER(COALESCE(type,''))='visitor')::int visitors " +
      "FROM people WHERE organization_id=$1 AND COALESCE(status,'active')='active'",
      [orgId]
    ),
    pool.query(
      "SELECT " +
      "COUNT(*) FILTER(WHERE started_at>=NOW()-INTERVAL '30 days')::int sessions_30d," +
      "COUNT(*) FILTER(WHERE started_at>=NOW()-INTERVAL '7 days')::int sessions_7d," +
      "COUNT(*) FILTER(WHERE started_at>=NOW()-INTERVAL '14 days' AND started_at<NOW()-INTERVAL '7 days')::int sessions_prev_7d," +
      "COUNT(*) FILTER(WHERE status='open')::int open_sessions," +
      "COUNT(*) FILTER(WHERE aria_processing_status IN('pending','processing'))::int processing_sessions," +
      "COUNT(*) FILTER(WHERE aria_processing_status='failed')::int failed_sessions," +
      "COUNT(*) FILTER(WHERE aria_processing_status='completed' AND aria_processing_error IS NOT NULL)::int completed_with_error " +
      "FROM sessions WHERE organization_id=$1",
      [orgId]
    ),
    pool.query(
      "SELECT COUNT(DISTINCT pm.person_id)::int people_with_human_memory," +
      "COUNT(*) FILTER(WHERE pm.active=true AND pm.is_current=true AND(pm.valid_until IS NULL OR pm.valid_until>NOW()))::int active_person_memory," +
      "(SELECT COUNT(*)::int FROM organization_memory om WHERE om.organization_id=$1 AND om.is_current=true AND(om.valid_until IS NULL OR om.valid_until>NOW())) org_memory," +
      "(SELECT COUNT(*)::int FROM care_feedback cf WHERE cf.organization_id=$1 AND cf.observed_at>=NOW()-INTERVAL '180 days') human_feedback," +
      "(SELECT COUNT(*)::int FROM intelligence_outcomes io WHERE io.organization_id=$1 AND io.created_at>=NOW()-INTERVAL '180 days') outcomes " +
      "FROM person_memory pm WHERE pm.organization_id=$1 AND pm.active=true AND pm.is_current=true",
      [orgId]
    ),
    pool.query(
      "SELECT " +
      "(SELECT COUNT(*)::int FROM scan_review_items s WHERE s.organization_id=$1 AND s.status='pending') pending_scan_reviews," +
      "(SELECT COUNT(*)::int FROM aria_events e WHERE e.organization_id=$1 AND e.processing_status IN('pending','failed','dead')) unhealthy_events," +
      "(SELECT COUNT(*)::int FROM aria_events e WHERE e.organization_id=$1 AND e.processing_status='pending') pending_events," +
      "(SELECT COUNT(*)::int FROM aria_events e WHERE e.organization_id=$1 AND e.processing_status='dead') dead_events," +
      "(SELECT COUNT(*)::int FROM aria_actions a WHERE a.organization_id=$1 AND a.status IN('proposed','approved','executing') AND a.priority IN('critical','high')) high_priority_actions",
      [orgId]
    ),
    pool.query(
      "SELECT type,COUNT(*)::int count FROM aria_observations " +
      "WHERE organization_id=$1 AND status='active' AND(expires_at IS NULL OR expires_at>NOW()) " +
      "GROUP BY type ORDER BY count DESC LIMIT 20",
      [orgId]
    ),
    pool.query(
      "SELECT type,status,priority,COALESCE(action_metadata->>'kind','care') kind,COUNT(*)::int count " +
      "FROM aria_actions WHERE organization_id=$1 AND status IN('proposed','approved','executing') " +
      "GROUP BY type,status,priority,COALESCE(action_metadata->>'kind','care') " +
      "ORDER BY CASE priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,count DESC",
      [orgId]
    ),
    pool.query(
      "SELECT COUNT(*)::int count," +
      "COUNT(*) FILTER(WHERE feedback_type IN('positive','helpful','responded','resolved'))::int positive," +
      "COUNT(*) FILTER(WHERE feedback_type IN('negative','ineffective','did_not_work','wrong_approach','wrong_timing','timing_wrong'))::int negative " +
      "FROM care_feedback WHERE organization_id=$1 AND observed_at>=NOW()-INTERVAL '180 days'",
      [orgId]
    ),
    getPriorityQueue(orgId,30),
    pool.query(
      "SELECT type,person_id,occurred_at,metadata FROM aria_events " +
      "WHERE organization_id=$1 AND occurred_at>=NOW()-INTERVAL '14 days' " +
      "ORDER BY occurred_at DESC LIMIT 80",
      [orgId]
    ),
    pool.query(
      "SELECT memory_type,memory_key,memory_value,confidence,source,valid_until,updated_at " +
      "FROM organization_memory WHERE organization_id=$1 AND is_current=true AND(valid_until IS NULL OR valid_until>NOW()) " +
      "ORDER BY confidence DESC,updated_at DESC LIMIT 30",
      [orgId]
    )
  ]);

  return {
    population:population.rows[0]||{},
    sessions:sessions.rows[0]||{},
    knowledge:knowledge.rows[0]||{},
    operations:operations.rows[0]||{},
    observations:observations.rows,
    actions:actions.rows,
    feedback:feedback.rows[0]||{},
    queue,
    recentSignals:recentSignals.rows,
    orgMemory:orgMemory.rows
  };
}

async function loadAttendanceLens(orgId) {
  const r = await pool.query(
    "WITH base AS(" +
    "SELECT p.id,p.first_name,p.last_name,p.display_name," +
    "COALESCE(em.participation_count,0)::int participation_count," +
    "COALESCE(em.participation_rate,0)::numeric participation_rate," +
    "COALESCE(em.trend,0)::numeric trend,COALESCE(em.deviation,0)::numeric deviation," +
    "COALESCE(pi.lifecycle_state,'unknown') lifecycle_state," +
    "COALESCE(pi.attention_level,'low') attention_level," +
    "COALESCE(pi.next_best_action,'') next_best_action,em.last_seen," +
    "COALESCE(rs.relationship_state,'known') relationship_state " +
    "FROM people p " +
    "LEFT JOIN engagement_metrics em ON em.organization_id=p.organization_id AND em.person_id=p.id " +
    "LEFT JOIN people_intelligence pi ON pi.organization_id=p.organization_id AND pi.person_id=p.id " +
    "LEFT JOIN relationship_scores rs ON rs.organization_id=p.organization_id AND rs.person_id=p.id " +
    "WHERE p.organization_id=$1 AND COALESCE(p.status,'active')='active')" +
    "SELECT * FROM base WHERE participation_count>=2 AND(trend<=-.25 OR deviation<=-.25) " +
    "ORDER BY CASE attention_level WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC," +
    "ABS(trend)+ABS(deviation) DESC LIMIT 30",
    [orgId]
  );

  return r.rows.map(x => ({
    person_id:x.id,
    person_name:nameOf(x),
    participation_count:x.participation_count,
    participation_rate:pct(x.participation_rate),
    trend:n(x.trend),
    deviation:n(x.deviation),
    lifecycle_state:x.lifecycle_state,
    attention_level:x.attention_level,
    next_best_action:x.next_best_action||null,
    last_attendance:x.last_seen,
    relationship_state:x.relationship_state,
    ...reconcileAttendanceCandidate(x)
  }));
}

function classifyAttention(queue,attendanceLens) {
  const byPerson = new Map();
  for(const item of attendanceLens) byPerson.set(String(item.person_id),item);

  return queue.filter(signalFresh).map(item => {
    const attendance = byPerson.get(String(item.person_id));
    const baseClass = signalClass(item);
    let classification = item.signal_type||'signal';
    let reason = item.reason;

    if(attendance?.classification==='new_relationship_watch' && baseClass==='human_care') {
      classification='new_relationship_watch';
      reason=attendance.reason;
    }

    return {
      person_id:item.person_id,
      person_name:nameOf(item),
      signal_type:item.signal_type,
      classification,
      class:baseClass,
      priority_score:n(item.priority_score),
      relationship_state:item.relationship_state||'unknown',
      lifecycle_state:item.lifecycle_state||null,
      participation_count:n(item.participation_count),
      participation_streak:n(item.participation_streak),
      last_attendance:item.last_attendance||null,
      observation_id:item.observation_id||null,
      observation_type:item.observation_type||null,
      observation_evidence:item.observation_evidence||null,
      action_id:item.action_id||null,
      action_type:item.action_type||null,
      action_status:item.action_status||null,
      reason,
      attendance_lens:attendance||null
    };
  });
}

function choosePrimary(population,operations,attention,attendanceLens) {
  const activePeople = n(population.people);
  const operational = n(operations.pending_scan_reviews)+n(operations.unhealthy_events)+n(operations.high_priority_actions);
  const formation = activePeople>0 &&
    (n(population.people_7d)>=Math.max(3,Math.ceil(activePeople*.2)) || daysBetween(population.first_person_at)<=14);
  const meaningfulAttendance = attendanceLens.filter(x=>x.classification==='emerging_attendance_decline'||x.classification==='extended_absence');

  if(operational>=3 && formation) {
    return {
      key:'stabilize_then_care',
      title:'Protect the intelligence before adding more work',
      summary:'ARIA sees rapid population growth and unresolved operational signals. Signal quality should be protected before broader follow-up is added.',
      reason:'Stale or failed signals can multiply noise and weaken trust in later care decisions.',
      priority:'high'
    };
  }

  if(operational>0 && operational>=attention.filter(x=>x.class==='human_care').length) {
    return {
      key:'system_integrity',
      title:'Keep ARIA trustworthy',
      summary:'There are operational signals that can affect how confidently ARIA interprets the organization.',
      reason:'Trustworthy care depends on trustworthy underlying state.',
      priority:'high'
    };
  }

  if(formation && n(population.visitors)>n(population.members)) {
    return {
      key:'relationship_formation',
      title:'Help the new population become known, not merely counted',
      summary:'The organization is in an early formation phase. Onboarding and relationship context matter more than optimizing retention metrics.',
      reason:'Most people are new and visitor-heavy, so raw attendance movement can be misleading.',
      priority:'medium'
    };
  }

  if(meaningfulAttendance.length) {
    return {
      key:'understand_change',
      title:'Understand the people whose pattern is genuinely changing',
      summary:'ARIA found attendance changes among people with enough history for the pattern to be meaningful.',
      reason:'These are stronger signals than one-off absence or first-time attendance gaps.',
      priority:'medium'
    };
  }

  const opportunities = attention.filter(x=>x.class==='organization_opportunity');
  if(opportunities.length) {
    return {
      key:'strengthen_good_moments',
      title:'Strengthen what is already going well',
      summary:'ARIA sees positive moments where recognition, belonging or contribution may be timely.',
      reason:'Not every useful intervention starts with a problem.',
      priority:'low'
    };
  }

  return {
    key:'observe',
    title:'Keep observing',
    summary:'ARIA does not see a high-value intervention that is stronger than continued observation right now.',
    reason:'The current evidence does not justify a larger intervention.',
    priority:'low'
  };
}

function buildContradictions(attendanceLens,operations) {
  const contradictions = [];
  const newButWeak = attendanceLens.filter(x=>x.classification==='new_relationship_watch');

  if(newButWeak.length) {
    contradictions.push({
      key:'newness_vs_weakening_pattern',
      severity:'medium',
      statement:String(newButWeak.length)+' people show a raw attendance weakening signal, but ARIA also sees their relationships as still forming. Those should not be treated as confirmed disengagement.',
      resolution:'Treat as WATCH or gentle relationship formation, not escalation.',
      people:newButWeak.slice(0,8).map(x=>x.person_name)
    });
  }

  if(n(operations.unhealthy_events)>0) {
    contradictions.push({
      key:'operational_noise_vs_human_attention',
      severity:'medium',
      statement:'Some operational signals and human-care signals are competing for the same attention budget.',
      resolution:'Keep operational integrity separate from people-care decisions.',
      people:[]
    });
  }

  return contradictions;
}

function buildInsight(core,attention,primary,contradictions) {
  const people=n(core.population.people);
  const days=daysBetween(core.population.first_person_at);
  const growth=n(core.population.people_7d);
  const memoryPeople=n(core.knowledge.people_with_human_memory);
  const coverage=people?Math.round((memoryPeople/people)*100):0;
  const operational=n(core.operations.pending_scan_reviews)+n(core.operations.unhealthy_events);

  if(people>=10 && days!==null && days<=14 && growth>=5) {
    return {
      kind:'organizational_transition',
      title:'The organization is growing faster than its relationship memory',
      statement:String(people)+' people are now known, but the population has only existed in the system for about '+String(days)+' day'+(days===1?'':'s')+' and '+String(growth)+' people arrived in the last seven days. Only '+String(coverage)+'% of people currently have recorded human memory. The important challenge is no longer discovering people; it is learning who they are without turning them into statistics.',
      evidence:[
        evidenceLine(String(people)+' active people; '+String(growth)+' added in the last seven days.','people.created_at',1),
        evidenceLine(String(coverage)+'% of active people have person memory.','person_memory',.95)
      ]
    };
  }

  if(operational>0) {
    return {
      kind:'trust',
      title:'ARIA should protect trust before increasing activity',
      statement:'ARIA has enough operational uncertainty that the safest intelligence move is to separate verified people-care signals from system-health noise before escalating outreach.',
      evidence:[
        evidenceLine(String(n(core.operations.pending_scan_reviews))+' scan review item(s) are still pending.','scan_review_items',1),
        evidenceLine(String(n(core.operations.unhealthy_events))+' unhealthy ARIA event(s) are present.','aria_events',1)
      ]
    };
  }

  if(contradictions.length) {
    return {
      kind:'reconciliation',
      title:'Two signals need interpretation, not escalation',
      statement:contradictions[0].statement+' '+contradictions[0].resolution,
      evidence:[evidenceLine(contradictions[0].statement,'director.reconciliation',.9)]
    };
  }

  if(attention.some(x=>x.class==='organization_opportunity')) {
    return {
      kind:'positive_opportunity',
      title:'ARIA found useful moments, not just problems',
      statement:'Some of the strongest current signals are opportunities to recognize, connect or invite people rather than reasons to intervene because something is wrong.',
      evidence:[evidenceLine('Priority queue contains positive recognition, belonging or contribution opportunities.','priority_queue',.9)]
    };
  }

  return {
    kind:'steady_state',
    title:'The organization is steady enough to observe',
    statement:primary.summary,
    evidence:[evidenceLine(primary.reason,'director',.85)]
  };
}

function buildHumanFocus(attention) {
  const out=[];
  const seen=new Set();
  for(const item of attention) {
    if(item.class==='watch') continue;
    if(seen.has(String(item.person_id))) continue;
    seen.add(String(item.person_id));
    out.push({
      person_id:item.person_id,
      name:item.person_name,
      reason:item.reason,
      classification:item.classification,
      action:item.action_type||null,
      observation:item.observation_type||null,
      priority_score:item.priority_score
    });
    if(out.length>=5) break;
  }
  return out;
}

export async function getDirectorBriefing(organizationId,{limit=8}={}) {
  if(!organizationId) throw new Error('organizationId required');

  const core=await loadCore(organizationId);
  const attendanceLens=await loadAttendanceLens(organizationId);
  const attention=classifyAttention(core.queue,attendanceLens);
  const primary=choosePrimary(core.population,core.operations,attention,attendanceLens);
  const contradictions=buildContradictions(attendanceLens,core.operations);
  const insight=buildInsight(core,attention,primary,contradictions);

  const safeLimit=Math.min(Math.max(Number(limit)||8,1),20);
  const careSignals=attention.filter(x=>x.class==='human_care').slice(0,safeLimit);
  const opportunities=attention.filter(x=>x.class==='organization_opportunity').slice(0,6);
  const memoryCoverage=n(core.population.people)
    ? Math.round((n(core.knowledge.people_with_human_memory)/n(core.population.people))*100)
    : 0;
  const maturityDays=daysBetween(core.population.first_person_at);

  const operationalSignals={
    pending_scan_reviews:n(core.operations.pending_scan_reviews),
    unhealthy_events:n(core.operations.unhealthy_events),
    pending_events:n(core.operations.pending_events),
    dead_events:n(core.operations.dead_events),
    processing_sessions:n(core.sessions.processing_sessions),
    failed_sessions:n(core.sessions.failed_sessions),
    high_priority_actions:n(core.operations.high_priority_actions)
  };

  const actionInventory=core.actions.reduce((acc,row)=>{
    const key=row.kind||row.type||'other';
    acc[key]=(acc[key]||0)+n(row.count);
    return acc;
  },{});

  return {
    version:ARIA_DIRECTOR_CORE_VERSION,
    generated_at:new Date().toISOString(),
    director:'ARIA',
    scope:'current_organization',
    state:{
      maturity_days:maturityDays,
      phase:maturityDays!==null&&maturityDays<=7?'setup':maturityDays!==null&&maturityDays<=21?'formation':'established',
      population:n(core.population.people),
      members:n(core.population.members),
      visitors:n(core.population.visitors),
      added_last_7_days:n(core.population.people_7d),
      added_previous_7_days:n(core.population.people_prev_7d),
      sessions_30_days:n(core.sessions.sessions_30d),
      sessions_last_7_days:n(core.sessions.sessions_7d),
      active_people_with_human_memory:n(core.knowledge.people_with_human_memory),
      human_memory_coverage_pct:memoryCoverage,
      organization_memory_count:n(core.knowledge.org_memory),
      human_feedback_count:n(core.knowledge.human_feedback),
      outcome_count:n(core.knowledge.outcomes)
    },
    primary_focus:{
      key:primary.key,
      title:primary.title,
      summary:primary.summary,
      reason:primary.reason,
      priority:primary.priority
    },
    intelligence:{
      contradictions,
      insight,
      operational_signals:operationalSignals,
      attention:{
        human_care_count:careSignals.length,
        opportunity_count:opportunities.length,
        raw_attendance_change_count:attendanceLens.length,
        meaningful_attendance_change_count:attendanceLens.filter(x=>['emerging_attendance_decline','extended_absence'].includes(x.classification)).length,
        top_human_focus:buildHumanFocus(careSignals)
      },
      action_inventory:actionInventory,
      observation_inventory:Object.fromEntries(core.observations.map(x=>[x.type,n(x.count)])),
      attendance_lens:attendanceLens.slice(0,12).map(x=>({
        person_id:x.person_id,
        person_name:x.person_name,
        classification:x.classification,
        participation_count:x.participation_count,
        participation_rate:x.participation_rate,
        trend:x.trend,
        deviation:x.deviation,
        lifecycle_state:x.lifecycle_state,
        reason:x.reason
      }))
    },
    decisions:{
      what_matters_now:primary.title,
      why_now:primary.reason,
      human_focus:buildHumanFocus(careSignals),
      opportunities:opportunities.map(x=>({
        person_id:x.person_id,
        name:x.person_name,
        type:x.signal_type,
        reason:x.reason,
        priority_score:x.priority_score
      })),
      watchlist:attendanceLens.filter(x=>x.classification==='new_relationship_watch').slice(0,8).map(x=>({
        person_id:x.person_id,
        name:x.person_name,
        reason:x.reason
      })),
      what_not_to_do:[
        'Do not treat every active observation as a problem; many are background memory events.',
        'Do not treat one attendance deviation as proof of disengagement.',
        'Do not turn a recommendation into an executed external action without human approval.'
      ]
    },
    evidence:{
      primary:[
        evidenceLine(String(n(core.population.people))+' active people with '+String(n(core.population.people_7d))+' added in the last seven days.','population'),
        evidenceLine(String(n(core.population.visitors))+' visitors and '+String(n(core.population.members))+' members are currently recorded.','people.type'),
        evidenceLine(String(memoryCoverage)+'% of active people have recorded person memory.','person_memory')
      ],
      recent_events:n(core.recentSignals.length),
      organization_memory:core.orgMemory.slice(0,8).map(m=>({
        type:m.memory_type,key:m.memory_key,confidence:n(m.confidence,.5),source:m.source,updated_at:m.updated_at
      }))
    },
    status:{
      trusted:operationalSignals.dead_events===0,
      data_freshness:'live',
      requires_human_decision:careSignals.some(x=>x.action_status==='proposed'),
      operational_risk:operationalSignals.failed_sessions>0 || operationalSignals.pending_scan_reviews>0 || operationalSignals.unhealthy_events>0
    }
  };
}

export function directorAnswerInstructions() {
  return [
    'ARIA is the intelligence, not a detached narrator.',
    'Use the director snapshot as the canonical interpretation of organizational state.',
    'Never contradict the snapshot by independently reinterpreting raw counts.',
    'Speak from the organization’s actual story: what changed, what matters, why now, what is uncertain, and what should happen next.',
    'Prefer synthesis over register-reading. A fact without interpretation is not a briefing.',
    'Separate people-care, positive opportunities, system-health issues and uncertainty.',
    'When two signals disagree, reconcile them explicitly instead of choosing one silently.',
    'Name a small number of people only when the evidence makes them useful; do not dump a queue.',
    'Be willing to say what ARIA is deliberately not treating as a problem.',
    'Surface at least one non-obvious insight when evidence supports one.',
    'Do not invent motives, reasons for absence, emotional states or organizational norms.',
    'Do not expose internal IDs or raw diagnostics.',
    'Human approval remains required for consequential actions.'
  ].join('\\n');
}
