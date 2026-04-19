#!/usr/bin/env node
import { dbPath } from '../lib/db.mjs';
import { loadEnvLocal } from '../lib/env.mjs';
import { openSqlite } from '../lib/sqlite.mjs';

const args = process.argv.slice(2);
const account = normalizeEmail(getArg(args, '--account') || process.env.GOG_ACCOUNT || 'richducat@gmail.com');
const dateArg = getArg(args, '--date');
const limit = toSafeInt(getArg(args, '--limit'), 50, 1, 500);
const jsonMode = hasFlag(args, '--json');
const runStartedAt = new Date().toISOString();
const internalDomainArgs = getArgValues(args, '--internal-domain')
  .map((d) => normalizeDomain(d))
  .filter(Boolean);

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

async function main() {
  loadEnvLocal();

  const targetDate = parseTargetDate(dateArg);
  const dayStart = new Date(targetDate.year, targetDate.month - 1, targetDate.day, 0, 0, 0, 0);
  const dayEnd = new Date(targetDate.year, targetDate.month - 1, targetDate.day, 23, 59, 59, 999);

  const internalDomains = dedupeArray([
    extractDomain(account),
    'thankyouforyourservice.co',
    ...internalDomainArgs,
  ].filter(Boolean));

  const db = openSqlite(dbPath('hybrid-core.sqlite'));
  try {
    assertHybridSchemaReady(db);
    const snapshotTableReady = hasTable(db, 'meeting_prep_attendee_snapshots');

    const events = db.prepare(`
      SELECT id, title, metadata_json
      FROM entities
      WHERE domain = 'crm' AND type = 'calendar_event'
      ORDER BY COALESCE(json_extract(metadata_json, '$.start'), json_extract(metadata_json, '$.timestamp'), updated_at) ASC
      LIMIT ?
    `).all(limit * 20);

    const attendeeStmt = db.prepare(`
      SELECT c.id, c.title, c.metadata_json
      FROM entity_links l
      JOIN entities c ON c.id = l.to_entity_id
      WHERE l.from_entity_id = ? AND l.relation_type = 'calendar_attendee'
      ORDER BY c.title COLLATE NOCASE ASC, c.id ASC
    `);

    const recentTouchesStmt = db.prepare(`
      SELECT g.title, g.metadata_json
      FROM entity_links l
      JOIN entities g ON g.id = l.from_entity_id
      WHERE l.to_entity_id = ?
        AND l.relation_type = 'gmail_counterparty'
        AND g.domain = 'crm'
        AND g.type = 'gmail_message'
      ORDER BY COALESCE(json_extract(g.metadata_json, '$.timestamp'), g.updated_at) DESC, g.updated_at DESC
      LIMIT 25
    `);

    const priorSnapshotStmt = snapshotTableReady
      ? db.prepare(`
        SELECT
          meeting_date,
          run_at,
          risk_level,
          risk_rank,
          confidence_score,
          touchpoints7d,
          touchpoints30d,
          touchpoints90d,
          response_status,
          last_touch_at
        FROM meeting_prep_attendee_snapshots
        WHERE account_email = ?
          AND event_id = ?
          AND attendee_email = ?
        ORDER BY run_at DESC, id DESC
        LIMIT 1
      `)
      : null;

    const insertSnapshotStmt = snapshotTableReady
      ? db.prepare(`
        INSERT INTO meeting_prep_attendee_snapshots (
          account_email,
          meeting_date,
          event_id,
          attendee_email,
          attendee_name,
          risk_level,
          risk_rank,
          confidence_score,
          touchpoints7d,
          touchpoints30d,
          touchpoints90d,
          response_status,
          last_touch_at,
          snapshot_json,
          run_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      : null;

    const briefs = [];
    for (const event of events) {
      if (briefs.length >= limit) break;
      const metadata = safeJson(event.metadata_json);
      const startIso = eventStartIso(metadata);
      if (!startIso) continue;

      const start = new Date(startIso);
      if (Number.isNaN(start.getTime())) continue;
      if (start < dayStart || start > dayEnd) continue;

      const attendees = attendeeStmt.all(event.id)
        .map((row) => normalizeAttendee(row))
        .filter((a) => a.email);

      const externalAttendees = attendees.filter((a) => isExternalAttendee(a.email, account, internalDomains));
      if (!externalAttendees.length) continue;

      const attendeeBriefs = externalAttendees.map((attendee) => {
        const touchRows = recentTouchesStmt.all(attendee.entityId).map(normalizeTouchRow);
        const relationshipSnapshot = buildRelationshipSnapshot(touchRows);
        const relationshipRisk = buildRelationshipRisk({
          attendee,
          snapshot: relationshipSnapshot,
        });
        const attendeeConfidence = buildAttendeeConfidence({
          attendee,
          snapshot: relationshipSnapshot,
          relationshipRisk,
        });
        const priorSnapshot = priorSnapshotStmt
          ? priorSnapshotStmt.get(account, event.id, attendee.email)
          : null;
        const relationshipRiskDelta = buildRelationshipRiskDelta({
          previous: priorSnapshot,
          current: {
            riskLevel: relationshipRisk.level,
            riskRank: riskLevelRank(relationshipRisk.level),
            confidenceScore: attendeeConfidence.score,
            touchpoints7d: Number(relationshipSnapshot.touchpoints7d || 0),
            touchpoints30d: Number(relationshipSnapshot.touchpoints30d || 0),
            touchpoints90d: Number(relationshipSnapshot.touchpoints90d || 0),
          },
        });
        const recommendedNextActions = buildRecommendedNextActions({
          attendee,
          snapshot: relationshipSnapshot,
          meetingStartIso: start.toISOString(),
        });
        const roleProfile = inferAttendeeRole({
          attendee,
          snapshot: relationshipSnapshot,
          relationshipRisk,
          attendeeConfidence,
        });
        const stakeholderIntentSummary = buildStakeholderIntentSummary({
          attendee,
          snapshot: relationshipSnapshot,
          relationshipRisk,
          roleProfile,
          attendeeConfidence,
        });

        return {
          email: attendee.email,
          name: attendee.name,
          responseStatus: attendee.responseStatus,
          lastTouch: relationshipSnapshot.lastTouch,
          relationshipSnapshot,
          relationshipRisk,
          relationshipRiskDelta,
          attendeeConfidence,
          roleProfile,
          stakeholderIntentSummary,
          recommendedNextActions,
        };
      });

      const relationshipRiskSignals = buildMeetingRiskSignals(attendeeBriefs);
      const meetingRiskDelta = buildMeetingRiskDeltaSummary(attendeeBriefs);
      const roleAwarePrepBrief = buildRoleAwarePrepBrief({
        title: event.title || '',
        attendees: attendeeBriefs,
        relationshipRiskSignals,
      });
      const agendaGapSignals = buildAgendaGapSignals({
        title: event.title || '',
        attendees: attendeeBriefs,
        relationshipRiskSignals,
      });
      const talkingPointSequence = buildTalkingPointSequence({
        title: event.title || '',
        attendees: attendeeBriefs,
        relationshipRiskSignals,
        roleAwarePrepBrief,
        agendaGapSignals,
      });
      const objectionRebuttalPacks = buildObjectionRebuttalPacks({
        attendees: attendeeBriefs,
      });
      const stakeholderIntentSummaries = buildStakeholderIntentSummaries({
        attendees: attendeeBriefs,
      });
      const negotiationFallbackPrompts = buildNegotiationFallbackPrompts({
        title: event.title || '',
        attendees: attendeeBriefs,
        relationshipRiskSignals,
        agendaGapSignals,
        stakeholderIntentSummaries,
      });
      const meetingRecommendations = buildMeetingRecommendations({
        title: event.title || '',
        attendees: attendeeBriefs,
        relationshipRiskSignals,
        meetingRiskDelta,
        agendaGapSignals,
      });
      const commitmentCloseChecklist = buildCommitmentCloseChecklist({
        title: event.title || '',
        attendees: attendeeBriefs,
        relationshipRiskSignals,
        agendaGapSignals,
        talkingPointSequence,
        stakeholderIntentSummaries,
      });
      const followUpDraftPack = buildFollowUpDraftPack({
        title: event.title || '',
        startIso: start.toISOString(),
        attendees: attendeeBriefs,
        relationshipRiskSignals,
        meetingRecommendations,
        commitmentCloseChecklist,
      });

      if (insertSnapshotStmt) {
        const tx = db.transaction((rows) => {
          for (const row of rows) {
            insertSnapshotStmt.run(
              account,
              toYmd(dayStart),
              event.id,
              row.email,
              row.name,
              row.relationshipRisk.level,
              riskLevelRank(row.relationshipRisk.level),
              row.attendeeConfidence.score,
              Number(row.relationshipSnapshot.touchpoints7d || 0),
              Number(row.relationshipSnapshot.touchpoints30d || 0),
              Number(row.relationshipSnapshot.touchpoints90d || 0),
              row.responseStatus || null,
              row.relationshipSnapshot?.lastTouch?.timestamp || null,
              JSON.stringify({
                relationshipRiskSignals: row.relationshipRisk.signals || [],
                confidenceLevel: row.attendeeConfidence.level,
              }),
              runStartedAt,
            );
          }
        });
        tx(attendeeBriefs);
      }

      briefs.push({
        eventId: event.id,
        title: cleanLine(event.title || '(untitled event)', 180),
        start: start.toISOString(),
        end: toIsoOrNull(metadata?.end),
        attendees: attendeeBriefs,
        relationshipRiskSignals,
        meetingRiskDelta,
        roleAwarePrepBrief,
        agendaGapSignals,
        talkingPointSequence,
        objectionRebuttalPacks,
        stakeholderIntentSummaries,
        negotiationFallbackPrompts,
        meetingRecommendations,
        commitmentCloseChecklist,
        followUpDraftPack,
      });
    }

    if (jsonMode) {
      console.log(JSON.stringify({
        account,
        date: toYmd(dayStart),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'local',
        internalDomains,
        meetings: briefs,
      }, null, 2));
      return;
    }

    printMarkdownBrief({
      account,
      date: toYmd(dayStart),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'local',
      internalDomains,
      meetings: briefs,
    });
  } finally {
    db.close();
  }
}

function printMarkdownBrief({ account, date, timezone, internalDomains, meetings }) {
  console.log(`# Meeting Prep Brief (${date})`);
  console.log('');
  console.log(`- Account: ${account}`);
  console.log(`- Timezone: ${timezone}`);
  console.log(`- Internal domains: ${internalDomains.join(', ')}`);
  console.log(`- External meetings: ${meetings.length}`);
  console.log('');

  if (!meetings.length) {
    console.log('No external meetings found for this date.');
    return;
  }

  for (const meeting of meetings) {
    console.log(`## ${toLocalHm(meeting.start)} - ${meeting.title}`);
    if (Array.isArray(meeting.meetingRecommendations) && meeting.meetingRecommendations.length) {
      console.log('- Meeting recommendations:');
      for (const rec of meeting.meetingRecommendations) {
        console.log(`  - ${rec.text} [confidence=${rec.confidence.score} (${rec.confidence.level})]`);
      }
    }
    if (Array.isArray(meeting.relationshipRiskSignals) && meeting.relationshipRiskSignals.length) {
      console.log('- Relationship risk signals:');
      for (const signal of meeting.relationshipRiskSignals) {
        console.log(`  - [${signal.severity}] ${signal.message}`);
      }
    }
    if (Array.isArray(meeting.roleAwarePrepBrief) && meeting.roleAwarePrepBrief.length) {
      console.log('- Role-aware prep brief:');
      for (const item of meeting.roleAwarePrepBrief) {
        console.log(`  - [${item.priority}] ${item.message}`);
      }
    }
    if (Array.isArray(meeting.agendaGapSignals) && meeting.agendaGapSignals.length) {
      console.log('- Agenda gaps:');
      for (const gap of meeting.agendaGapSignals) {
        console.log(`  - [${gap.severity}] ${gap.message} -> ${gap.recommendation}`);
      }
    }
    if (Array.isArray(meeting.talkingPointSequence) && meeting.talkingPointSequence.length) {
      console.log('- Talking-point sequence:');
      for (const point of meeting.talkingPointSequence) {
        const drivers = Array.isArray(point.drivers) && point.drivers.length ? ` [drivers=${point.drivers.join(', ')}]` : '';
        console.log(`  - (${point.order}) [${point.priority}] ${point.objective} -> ${point.prompt}${drivers}`);
      }
    }
    if (Array.isArray(meeting.objectionRebuttalPacks) && meeting.objectionRebuttalPacks.length) {
      console.log('- Objection rebuttal packs:');
      for (const pack of meeting.objectionRebuttalPacks) {
        const who = pack.attendeeName ? `${pack.attendeeName} <${pack.attendeeEmail}>` : pack.attendeeEmail;
        console.log(`  - [${pack.priority}] ${who}`);
        for (const item of pack.objections || []) {
          console.log(`    - Objection: ${item.objection}`);
          console.log(`      - Rebuttal: ${item.rebuttal}`);
          console.log(`      - Evidence: ${item.evidence}`);
          console.log(`      - Next ask: ${item.nextAsk}`);
        }
      }
    }
    if (Array.isArray(meeting.stakeholderIntentSummaries) && meeting.stakeholderIntentSummaries.length) {
      console.log('- Stakeholder intent summaries:');
      for (const intent of meeting.stakeholderIntentSummaries) {
        const who = intent.attendeeName ? `${intent.attendeeName} <${intent.attendeeEmail}>` : intent.attendeeEmail;
        console.log(`  - [${intent.priority}] ${who}: ${intent.intent} -> ${intent.approach}`);
      }
    }
    if (Array.isArray(meeting.negotiationFallbackPrompts) && meeting.negotiationFallbackPrompts.length) {
      console.log('- Negotiation fallback prompts:');
      for (const prompt of meeting.negotiationFallbackPrompts) {
        const drivers = Array.isArray(prompt.drivers) && prompt.drivers.length
          ? ` [drivers=${prompt.drivers.join(', ')}]`
          : '';
        console.log(`  - [${prompt.priority}] ${prompt.trigger} -> ${prompt.prompt}${drivers}`);
      }
    }
    if (Array.isArray(meeting.commitmentCloseChecklist) && meeting.commitmentCloseChecklist.length) {
      console.log('- Commitment closeout checklist:');
      for (const item of meeting.commitmentCloseChecklist) {
        console.log(`  - [${item.priority}] ${item.check}`);
        if (item.ownerHint) {
          console.log(`    - Owner hint: ${item.ownerHint}`);
        }
        if (item.why) {
          console.log(`    - Why: ${item.why}`);
        }
      }
    }
    if (meeting.followUpDraftPack) {
      console.log('- Follow-up draft pack:');
      console.log(`  - Subject: ${meeting.followUpDraftPack.subject}`);
      console.log(`  - Send by: ${meeting.followUpDraftPack.sendBy}`);
      if (meeting.followUpDraftPack.recipientsHint) {
        console.log(`  - Recipients: ${meeting.followUpDraftPack.recipientsHint}`);
      }
      if (meeting.followUpDraftPack.summary) {
        console.log(`  - Summary: ${meeting.followUpDraftPack.summary}`);
      }
      if (Array.isArray(meeting.followUpDraftPack.asks) && meeting.followUpDraftPack.asks.length) {
        for (const ask of meeting.followUpDraftPack.asks) {
          console.log(`  - Ask: ${ask}`);
        }
      }
      if (Array.isArray(meeting.followUpDraftPack.messageLines) && meeting.followUpDraftPack.messageLines.length) {
        for (const line of meeting.followUpDraftPack.messageLines) {
          console.log(`  - Draft line: ${line}`);
        }
      }
    }
    if (meeting.meetingRiskDelta) {
      const delta = meeting.meetingRiskDelta;
      console.log(
        `- Risk delta vs prior run: improved=${delta.improved}, declined=${delta.declined}, unchanged=${delta.unchanged}, new=${delta.newAttendees}, no_prior=${delta.noPriorComparison}, net_shift=${delta.netRiskShift}`
      );
    }
    for (const attendee of meeting.attendees) {
      const who = attendee.name ? `${attendee.name} <${attendee.email}>` : attendee.email;
      if (attendee.lastTouch) {
        console.log(`- ${who}: last touch ${attendee.lastTouch.date} - ${attendee.lastTouch.subject}`);
      } else {
        console.log(`- ${who}: no prior Gmail touchpoint found`);
      }
      const snapshot = attendee.relationshipSnapshot || {};
      console.log(
        `  - Snapshot: 7d=${snapshot.touchpoints7d || 0}, 30d=${snapshot.touchpoints30d || 0}, 90d=${snapshot.touchpoints90d || 0}`
      );
      if (Array.isArray(snapshot.recentSubjects) && snapshot.recentSubjects.length) {
        console.log(`  - Recent subjects: ${snapshot.recentSubjects.join(' | ')}`);
      }
      const risk = attendee.relationshipRisk || {};
      if (risk.level && risk.level !== 'low') {
        console.log(`  - Relationship risk: ${risk.level} (${(risk.signals || []).join('; ')})`);
      }
      const confidence = attendee.attendeeConfidence || null;
      if (confidence) {
        console.log(`  - Confidence: ${confidence.score} (${confidence.level})`);
      }
      const role = attendee.roleProfile || null;
      if (role) {
        console.log(`  - Role profile: ${role.role} (${(role.signals || []).join('; ')})`);
      }
      const intent = attendee.stakeholderIntentSummary || null;
      if (intent) {
        console.log(`  - Stakeholder intent: ${intent.intent} (${intent.confidence}, ${intent.approach})`);
      }
      const delta = attendee.relationshipRiskDelta || null;
      if (delta && delta.hasPreviousSnapshot) {
        console.log(
          `  - Risk delta vs prior: ${delta.direction} (risk ${delta.previousRiskLevel} -> ${delta.currentRiskLevel}; confidence ${delta.previousConfidenceScore} -> ${delta.currentConfidenceScore})`
        );
      }
      if (Array.isArray(attendee.recommendedNextActions) && attendee.recommendedNextActions.length) {
        for (const action of attendee.recommendedNextActions) {
          console.log(`  - Next action: ${action}`);
        }
      }
    }
    console.log('');
  }
}

function normalizeTouchRow(row) {
  const metadata = safeJson(row?.metadata_json);
  const ts = toIsoOrNull(metadata?.timestamp);
  return {
    timestamp: ts,
    date: ts ? ts.slice(0, 10) : null,
    subject: cleanLine(row?.title || '', 180) || '(no subject)',
  };
}

function buildRelationshipSnapshot(touches) {
  const now = Date.now();
  const withTime = touches
    .map((t) => ({
      ...t,
      ms: t.timestamp ? Date.parse(t.timestamp) : Number.NaN,
    }))
    .filter((t) => Number.isFinite(t.ms));

  const inDays = (days) => {
    const cutoff = now - days * 24 * 60 * 60 * 1000;
    return withTime.filter((t) => t.ms >= cutoff).length;
  };

  return {
    touchpoints7d: inDays(7),
    touchpoints30d: inDays(30),
    touchpoints90d: inDays(90),
    recentSubjects: withTime.slice(0, 3).map((t) => `${t.date}: ${t.subject}`),
    lastTouch: withTime.length ? {
      date: withTime[0].date,
      timestamp: withTime[0].timestamp,
      subject: withTime[0].subject,
    } : null,
  };
}

function buildRelationshipRisk({ attendee, snapshot }) {
  const now = Date.now();
  const signals = [];
  let level = 'low';
  const response = (attendee?.responseStatus || '').toLowerCase();
  const lastTouchTs = snapshot?.lastTouch?.timestamp;
  const touchpoints90d = Number(snapshot?.touchpoints90d || 0);

  if (!lastTouchTs) {
    signals.push('No prior touchpoint found in CRM history.');
    level = raiseRisk(level, 'high');
  } else {
    const lastTouchMs = Date.parse(lastTouchTs);
    if (Number.isFinite(lastTouchMs)) {
      const ageDays = Math.floor((now - lastTouchMs) / (24 * 60 * 60 * 1000));
      if (ageDays > 45) {
        signals.push(`Last touchpoint is stale (${ageDays}d old).`);
        level = raiseRisk(level, 'high');
      } else if (ageDays > 21) {
        signals.push(`Last touchpoint is aging (${ageDays}d old).`);
        level = raiseRisk(level, 'medium');
      }
    }
  }

  if (touchpoints90d <= 1) {
    signals.push(`Sparse relationship history in last 90d (${touchpoints90d} touchpoint${touchpoints90d === 1 ? '' : 's'}).`);
    level = raiseRisk(level, 'medium');
  }

  if (response === 'declined') {
    signals.push('Attendee has declined this event.');
    level = raiseRisk(level, 'high');
  } else if (response === 'tentative' || response === 'needsaction') {
    signals.push('Attendee RSVP is not fully confirmed.');
    level = raiseRisk(level, 'medium');
  }

  return {
    level,
    signals: dedupeArray(signals).slice(0, 3),
  };
}

function buildMeetingRiskSignals(attendees) {
  const byCode = new Map();
  const push = (code, severity, message, attendeeEmail) => {
    if (!byCode.has(code)) byCode.set(code, { code, severity, message, count: 0, attendees: [] });
    const bucket = byCode.get(code);
    bucket.count += 1;
    bucket.attendees.push(attendeeEmail);
  };

  for (const attendee of attendees) {
    const email = attendee.email;
    const risk = attendee.relationshipRisk || {};
    const response = (attendee.responseStatus || '').toLowerCase();
    const touchpoints90d = Number(attendee.relationshipSnapshot?.touchpoints90d || 0);
    const lastTouchTs = attendee.relationshipSnapshot?.lastTouch?.timestamp;

    if (!lastTouchTs) push('no_prior_touchpoint', 'high', 'Attendees with no prior CRM touchpoint history.', email);
    if (touchpoints90d <= 1) push('sparse_90d_history', 'medium', 'Attendees with sparse relationship history over 90 days.', email);
    if (response === 'needsaction' || response === 'tentative') {
      push('rsvp_unconfirmed', 'medium', 'Attendees with unconfirmed RSVP status.', email);
    }
    if (response === 'declined') push('rsvp_declined', 'high', 'Attendees marked as declined.', email);
    if (risk.level === 'high') push('high_individual_risk', 'high', 'Attendees with high individual relationship risk.', email);
  }

  const orderedCodes = [
    'high_individual_risk',
    'rsvp_declined',
    'no_prior_touchpoint',
    'rsvp_unconfirmed',
    'sparse_90d_history',
  ];
  const out = [];
  for (const code of orderedCodes) {
    const bucket = byCode.get(code);
    if (!bucket) continue;
    const attendeesUnique = dedupeArray(bucket.attendees);
    out.push({
      code: bucket.code,
      severity: bucket.severity,
      count: attendeesUnique.length,
      attendees: attendeesUnique.sort(),
      message: `${bucket.message} (${attendeesUnique.length} attendee${attendeesUnique.length === 1 ? '' : 's'})`,
    });
  }
  return out;
}

function buildMeetingRecommendations({ title, attendees, relationshipRiskSignals, agendaGapSignals }) {
  const actions = [];
  const total = attendees.length || 1;

  const signalByCode = new Map((relationshipRiskSignals || []).map((s) => [s.code, s]));

  const noTouch = signalByCode.get('no_prior_touchpoint');
  if (noTouch) {
    actions.push(`Send a short first-touch pre-read to ${noTouch.count} attendee${noTouch.count === 1 ? '' : 's'} before the meeting.`);
  }

  const unconfirmed = signalByCode.get('rsvp_unconfirmed');
  if (unconfirmed) {
    actions.push(`Confirm RSVP status for ${unconfirmed.count} attendee${unconfirmed.count === 1 ? '' : 's'} before start time.`);
  }

  const declined = signalByCode.get('rsvp_declined');
  if (declined) {
    actions.push('Decide go/no-go scope now for declined attendees and identify alternates if needed.');
  }

  const sparse = signalByCode.get('sparse_90d_history');
  if (sparse && sparse.count / total >= 0.5) {
    actions.push('Start with a concise context reset because at least half of external attendees have sparse recent history.');
  }

  const high = signalByCode.get('high_individual_risk');
  if (high) {
    actions.push('Allocate extra time for relationship repair: lead with objective clarity and one explicit commitment per high-risk attendee.');
  }
  const agendaGaps = Array.isArray(agendaGapSignals) ? agendaGapSignals : [];
  for (const gap of agendaGaps) {
    actions.push(`Agenda gap fix: ${gap.recommendation}`);
  }
  if (hasKeyword(title, ['kickoff', 'onboarding']) && !hasKeyword(title, ['timeline', 'plan', 'next step'])) {
    actions.push('Add a next-step timeline block so kickoff outcomes are concrete.');
  }

  if (!actions.length) {
    actions.push('Proceed with standard agenda; no elevated cross-attendee relationship risk detected.');
  }

  const uniqueActions = dedupeArray(actions).slice(0, 5);
  return uniqueActions.map((text) => buildMeetingRecommendationScore({
    text,
    attendees,
    relationshipRiskSignals,
    totalAttendees: total,
  }));
}

function buildMeetingRecommendationScore({ text, attendees, relationshipRiskSignals, totalAttendees }) {
  const safeTotal = Number(totalAttendees || attendees.length || 1);
  const avgAttendeeConfidence = attendees.length
    ? attendees.reduce((sum, a) => sum + Number(a?.attendeeConfidence?.score || 0), 0) / attendees.length
    : 40;
  const highSignals = (relationshipRiskSignals || []).filter((s) => s.severity === 'high')
    .reduce((sum, s) => sum + Number(s.count || 0), 0);
  const mediumSignals = (relationshipRiskSignals || []).filter((s) => s.severity === 'medium')
    .reduce((sum, s) => sum + Number(s.count || 0), 0);

  let score = Math.round(avgAttendeeConfidence * 0.65 + 28);
  score -= Math.round((highSignals / safeTotal) * 18);
  score -= Math.round((mediumSignals / safeTotal) * 8);

  const rationale = [
    `Avg attendee confidence ${Math.round(avgAttendeeConfidence)}.`,
    `High-risk signal load ${highSignals}/${safeTotal}.`,
    `Medium-risk signal load ${mediumSignals}/${safeTotal}.`,
  ];

  score = clampInt(score, 10, 95);
  return {
    text,
    confidence: {
      score,
      level: confidenceLevelFor(score),
      rationale,
    },
  };
}

function buildAttendeeConfidence({ attendee, snapshot, relationshipRisk }) {
  const touchpoints90d = Number(snapshot?.touchpoints90d || 0);
  const lastTouchTs = snapshot?.lastTouch?.timestamp || null;
  const response = (attendee?.responseStatus || '').toLowerCase();
  const rationale = [];

  const volumeScore = clampInt(Math.round((Math.min(touchpoints90d, 6) / 6) * 40), 0, 40);
  rationale.push(`Touchpoint volume score ${volumeScore}/40 (90d=${touchpoints90d}).`);

  let recencyScore = 0;
  if (lastTouchTs) {
    const ageDays = Math.max(0, Math.floor((Date.now() - Date.parse(lastTouchTs)) / (24 * 60 * 60 * 1000)));
    if (ageDays <= 7) recencyScore = 30;
    else if (ageDays <= 21) recencyScore = 20;
    else if (ageDays <= 45) recencyScore = 10;
    rationale.push(`Recency score ${recencyScore}/30 (${ageDays}d since last touch).`);
  } else {
    rationale.push('Recency score 0/30 (no prior touchpoint).');
  }

  let rsvpScore = 8;
  if (response === 'accepted') rsvpScore = 20;
  else if (response === 'tentative' || response === 'needsaction') rsvpScore = 10;
  else if (response === 'declined') rsvpScore = 12;
  rationale.push(`RSVP clarity score ${rsvpScore}/20 (status=${response || 'unknown'}).`);

  const identityScore = attendee?.name ? 10 : 5;
  rationale.push(`Identity score ${identityScore}/10 (${attendee?.name ? 'named contact' : 'email-only contact'}).`);

  let riskPenalty = 0;
  if (relationshipRisk?.level === 'high') riskPenalty = 12;
  else if (relationshipRisk?.level === 'medium') riskPenalty = 6;
  rationale.push(`Risk penalty ${riskPenalty} (risk=${relationshipRisk?.level || 'low'}).`);

  const score = clampInt(volumeScore + recencyScore + rsvpScore + identityScore - riskPenalty, 0, 100);
  return {
    score,
    level: confidenceLevelFor(score),
    rationale,
  };
}

function buildRelationshipRiskDelta({ previous, current }) {
  if (!previous) {
    return {
      hasPreviousSnapshot: false,
      direction: 'new',
      previousRiskLevel: null,
      currentRiskLevel: current.riskLevel,
      previousConfidenceScore: null,
      currentConfidenceScore: current.confidenceScore,
      riskLevelDelta: null,
      confidenceScoreDelta: null,
      touchpoints7dDelta: null,
      touchpoints30dDelta: null,
      touchpoints90dDelta: null,
      previousRunAt: null,
    };
  }

  const previousRiskRank = Number(previous.risk_rank || 0);
  const currentRiskRank = Number(current.riskRank || 0);
  const riskLevelDelta = currentRiskRank - previousRiskRank;

  let direction = 'unchanged';
  if (riskLevelDelta > 0) direction = 'declined';
  else if (riskLevelDelta < 0) direction = 'improved';

  return {
    hasPreviousSnapshot: true,
    direction,
    previousRiskLevel: previous.risk_level || null,
    currentRiskLevel: current.riskLevel || null,
    previousConfidenceScore: Number(previous.confidence_score || 0),
    currentConfidenceScore: Number(current.confidenceScore || 0),
    riskLevelDelta,
    confidenceScoreDelta: Number(current.confidenceScore || 0) - Number(previous.confidence_score || 0),
    touchpoints7dDelta: Number(current.touchpoints7d || 0) - Number(previous.touchpoints7d || 0),
    touchpoints30dDelta: Number(current.touchpoints30d || 0) - Number(previous.touchpoints30d || 0),
    touchpoints90dDelta: Number(current.touchpoints90d || 0) - Number(previous.touchpoints90d || 0),
    previousRunAt: previous.run_at || null,
  };
}

function buildMeetingRiskDeltaSummary(attendees) {
  const summary = {
    improved: 0,
    declined: 0,
    unchanged: 0,
    newAttendees: 0,
    noPriorComparison: 0,
    netRiskShift: 0,
  };

  for (const attendee of attendees) {
    const delta = attendee?.relationshipRiskDelta;
    if (!delta) {
      summary.noPriorComparison += 1;
      continue;
    }
    if (!delta.hasPreviousSnapshot) {
      summary.newAttendees += 1;
      continue;
    }
    if (delta.direction === 'improved') summary.improved += 1;
    else if (delta.direction === 'declined') summary.declined += 1;
    else summary.unchanged += 1;

    summary.netRiskShift += Number(delta.riskLevelDelta || 0);
  }

  summary.noPriorComparison += summary.newAttendees;
  return summary;
}

function buildRecommendedNextActions({ attendee, snapshot, meetingStartIso }) {
  const actions = [];
  const lastTouch = snapshot?.lastTouch || null;
  const response = (attendee?.responseStatus || '').toLowerCase();
  const meetingStartMs = Date.parse(meetingStartIso);

  if (!lastTouch) {
    actions.push('Send a first-touch note with agenda and objective before the meeting.');
  } else {
    const lastTouchMs = Date.parse(lastTouch.timestamp);
    const ageDays = Number.isFinite(lastTouchMs)
      ? Math.floor((Date.now() - lastTouchMs) / (24 * 60 * 60 * 1000))
      : null;

    if (ageDays !== null && ageDays > 30) {
      actions.push(`Re-open the ${lastTouch.date} thread ("${lastTouch.subject}") with refreshed context and explicit next step.`);
    } else if (ageDays !== null && ageDays > 7) {
      actions.push(`Send a short pre-meeting follow-up on "${lastTouch.subject}" to confirm priorities.`);
    } else {
      actions.push(`Continue in the existing "${lastTouch.subject}" thread and close with one clear decision ask.`);
    }
  }

  if (response === 'needsaction' || response === 'tentative') {
    actions.push('Request attendance confirmation before start time.');
  }
  if (response === 'declined') {
    actions.push('Decide whether to proceed without this attendee or reschedule with an alternate slot.');
  }

  const touchpoints30d = Number(snapshot?.touchpoints30d || 0);
  if (touchpoints30d >= 3) {
    actions.push('Prepare a concise progress recap from recent touchpoints to avoid repeating context.');
  }

  if (Number.isFinite(meetingStartMs)) {
    const hoursToMeeting = (meetingStartMs - Date.now()) / (60 * 60 * 1000);
    if (hoursToMeeting >= 0 && hoursToMeeting <= 6) {
      actions.push('Share a one-line agenda/check-in message now due to near-term meeting start.');
    }
  }

  return dedupeArray(actions).slice(0, 4);
}

function inferAttendeeRole({ attendee, snapshot, relationshipRisk, attendeeConfidence }) {
  const response = String(attendee?.responseStatus || '').toLowerCase();
  const touch30 = Number(snapshot?.touchpoints30d || 0);
  const touch90 = Number(snapshot?.touchpoints90d || 0);
  const confidenceScore = Number(attendeeConfidence?.score || 0);
  const riskLevel = String(relationshipRisk?.level || 'low');
  const signals = [];
  let role = 'observer';

  if (response === 'declined') {
    role = 'blocked stakeholder';
    signals.push('Declined RSVP indicates participation risk.');
  } else if (response === 'accepted' && confidenceScore >= 70 && touch90 >= 4 && riskLevel === 'low') {
    role = 'decision partner';
    signals.push('Accepted + high confidence + strong history indicates likely decision influence.');
  } else if (response === 'accepted' && touch30 >= 2) {
    role = 'active collaborator';
    signals.push('Accepted + recent touchpoints indicates active working relationship.');
  } else if ((response === 'tentative' || response === 'needsaction') && touch90 >= 2) {
    role = 'at-risk stakeholder';
    signals.push('Unconfirmed RSVP with prior history indicates alignment risk.');
  } else if (touch90 === 0) {
    role = 'new stakeholder';
    signals.push('No 90-day touchpoint history indicates new relationship context.');
  } else {
    signals.push('Limited deterministic signals; treat as observer until clarified.');
  }

  if (riskLevel === 'high') {
    signals.push('High relationship-risk level requires explicit alignment checks.');
  }

  return {
    role,
    signals: dedupeArray(signals).slice(0, 3),
  };
}

function buildStakeholderIntentSummary({ attendee, snapshot, relationshipRisk, roleProfile, attendeeConfidence }) {
  const response = String(attendee?.responseStatus || '').toLowerCase();
  const role = String(roleProfile?.role || 'observer');
  const riskLevel = String(relationshipRisk?.level || 'low');
  const confidenceScore = Number(attendeeConfidence?.score || 0);
  const touch30 = Number(snapshot?.touchpoints30d || 0);
  const touch90 = Number(snapshot?.touchpoints90d || 0);
  const lastTouchTs = snapshot?.lastTouch?.timestamp || null;
  const signals = [];
  let intent = 'context validation';
  let approach = 'start with objective + context summary, then confirm understanding';
  let priority = 'low';

  if (response === 'declined' || role === 'blocked stakeholder') {
    intent = 'participation flexibility';
    approach = 'offer delegate + async decision path with explicit checkpoint';
    priority = 'high';
    signals.push('RSVP declined or blocked role profile.');
  } else if (riskLevel === 'high' || role === 'at-risk stakeholder') {
    intent = 'constraint mitigation';
    approach = 'surface blockers early and secure one named mitigation commitment';
    priority = 'high';
    signals.push('High relationship-risk alignment signal.');
  } else if (role === 'decision partner') {
    intent = 'decision closure';
    approach = 'present options with tradeoffs and request final owner/date';
    priority = 'high';
    signals.push('Decision partner role profile.');
  } else if (role === 'new stakeholder') {
    intent = 'scope clarity';
    approach = 'give concise context reset and verify success criteria before details';
    priority = 'medium';
    signals.push('New stakeholder profile with limited history.');
  } else if (confidenceScore < 45 || touch90 <= 1) {
    intent = 'evidence confidence';
    approach = 'narrow to minimum decision and define required evidence checkpoint';
    priority = 'medium';
    signals.push('Low confidence / sparse relationship history.');
  } else if (touch30 >= 3 && response === 'accepted') {
    intent = 'execution acceleration';
    approach = 'skip baseline context and convert directly to owner-assigned next steps';
    priority = 'medium';
    signals.push('Recent high-touch accepted attendee.');
  }

  if (!lastTouchTs) {
    signals.push('No prior touchpoint available.');
  } else {
    const ageDays = Math.max(0, Math.floor((Date.now() - Date.parse(lastTouchTs)) / (24 * 60 * 60 * 1000)));
    if (ageDays > 30) signals.push(`Last touchpoint is stale (${ageDays}d).`);
  }

  return {
    intent,
    approach,
    priority,
    confidence: confidenceLevelFor(confidenceScore),
    signals: dedupeArray(signals).slice(0, 3),
  };
}

function buildRoleAwarePrepBrief({ title, attendees, relationshipRiskSignals }) {
  const roleCounts = new Map();
  for (const attendee of attendees || []) {
    const role = attendee?.roleProfile?.role || 'observer';
    roleCounts.set(role, (roleCounts.get(role) || 0) + 1);
  }

  const highSignalCount = (relationshipRiskSignals || [])
    .filter((s) => s.severity === 'high')
    .reduce((sum, s) => sum + Number(s.count || 0), 0);

  const items = [];
  const decisionPartners = Number(roleCounts.get('decision partner') || 0);
  if (decisionPartners > 0) {
    items.push({
      code: 'role_decision_partner',
      priority: 'high',
      message: `Lead with a concrete decision ask and options table for ${decisionPartners} decision partner attendee${decisionPartners === 1 ? '' : 's'}.`,
    });
  }

  const newStakeholders = Number(roleCounts.get('new stakeholder') || 0);
  if (newStakeholders > 0) {
    items.push({
      code: 'role_new_stakeholder',
      priority: 'medium',
      message: `Include a 60-second context reset for ${newStakeholders} new stakeholder attendee${newStakeholders === 1 ? '' : 's'}.`,
    });
  }

  const atRiskStakeholders = Number(roleCounts.get('at-risk stakeholder') || 0) + Number(roleCounts.get('blocked stakeholder') || 0);
  if (atRiskStakeholders > 0 || highSignalCount > 0) {
    items.push({
      code: 'role_alignment_risk',
      priority: 'high',
      message: 'Reserve explicit alignment time early in the agenda for RSVP or relationship-risk concerns.',
    });
  }

  const activeCollaborators = Number(roleCounts.get('active collaborator') || 0);
  if (activeCollaborators > 0 && hasKeyword(title, ['review', 'sync', 'kickoff'])) {
    items.push({
      code: 'role_execution_owner',
      priority: 'medium',
      message: `Pre-assign owner handoffs for ${activeCollaborators} active collaborator attendee${activeCollaborators === 1 ? '' : 's'}.`,
    });
  }

  if (!items.length) {
    items.push({
      code: 'role_default',
      priority: 'low',
      message: 'Run a standard brief: objective, context reset, decisions, and explicit next owners.',
    });
  }

  return items;
}

function buildAgendaGapSignals({ title, attendees, relationshipRiskSignals }) {
  const gaps = [];
  const safeTitle = String(title || '');
  const roleCounts = new Map();
  for (const attendee of attendees || []) {
    const role = attendee?.roleProfile?.role || 'observer';
    roleCounts.set(role, (roleCounts.get(role) || 0) + 1);
  }
  const signalByCode = new Map((relationshipRiskSignals || []).map((s) => [s.code, s]));

  const hasDecisionCue = hasKeyword(safeTitle, ['decision', 'approve', 'approval', 'go/no-go', 'review']);
  const hasContextCue = hasKeyword(safeTitle, ['kickoff', 'intro', 'onboard', 'status', 'sync', 'update']);
  const hasRiskCue = hasKeyword(safeTitle, ['risk', 'blocker', 'issue', 'concern', 'escalation']);
  const hasActionCue = hasKeyword(safeTitle, ['plan', 'next', 'timeline', 'action', 'owner']);

  if (Number(roleCounts.get('decision partner') || 0) > 0 && !hasDecisionCue) {
    gaps.push({
      code: 'missing_decision_block',
      severity: 'high',
      message: 'Decision-partner attendees are present but the meeting title does not indicate a decision block.',
      recommendation: 'Add an explicit decision segment with choices and owner/date for final call.',
    });
  }

  if (Number(roleCounts.get('new stakeholder') || 0) > 0 && !hasContextCue) {
    gaps.push({
      code: 'missing_context_reset',
      severity: 'medium',
      message: 'New stakeholders are present but no clear context-reset cue was detected.',
      recommendation: 'Add a short context reset section before detailed discussion.',
    });
  }

  if ((signalByCode.has('rsvp_unconfirmed') || signalByCode.has('rsvp_declined')) && !hasActionCue) {
    gaps.push({
      code: 'missing_rsvp_alignment',
      severity: 'medium',
      message: 'RSVP instability is present but no explicit alignment/action cue was detected.',
      recommendation: 'Add an attendance/alignment checkpoint with contingency owner.',
    });
  }

  if (signalByCode.has('high_individual_risk') && !hasRiskCue) {
    gaps.push({
      code: 'missing_risk_mitigation',
      severity: 'high',
      message: 'High relationship-risk signals exist without an obvious risk-mitigation agenda cue.',
      recommendation: 'Add a dedicated risk/objection segment with mitigation commitments.',
    });
  }

  if ((attendees || []).length >= 2 && !hasActionCue) {
    gaps.push({
      code: 'missing_owner_next_step',
      severity: 'medium',
      message: 'Multi-attendee meeting lacks a clear next-step/owner cue in the agenda context.',
      recommendation: 'Close with owner-assigned next steps and due dates.',
    });
  }

  return dedupeByCode(gaps).slice(0, 5);
}

function buildTalkingPointSequence({
  title,
  attendees,
  relationshipRiskSignals,
  roleAwarePrepBrief,
  agendaGapSignals,
}) {
  const roleCounts = new Map();
  for (const attendee of attendees || []) {
    const role = attendee?.roleProfile?.role || 'observer';
    roleCounts.set(role, (roleCounts.get(role) || 0) + 1);
  }
  const signalByCode = new Map((relationshipRiskSignals || []).map((s) => [s.code, s]));
  const gapByCode = new Map((agendaGapSignals || []).map((g) => [g.code, g]));
  const roleByCode = new Map((roleAwarePrepBrief || []).map((item) => [item.code, item]));

  const sequence = [];
  const push = (code, priority, objective, prompt, drivers = []) => {
    if (sequence.some((point) => point.code === code)) return;
    sequence.push({
      code,
      priority,
      objective,
      prompt,
      drivers: dedupeArray(drivers).slice(0, 4),
    });
  };

  push(
    'objective_alignment',
    'high',
    'Align everyone on objective and success criteria.',
    'State target outcome, decision required, and completion signal in the first 60 seconds.',
    ['baseline_opening']
  );

  if (roleByCode.has('role_new_stakeholder') || gapByCode.has('missing_context_reset')) {
    push(
      'context_reset',
      'medium',
      'Reset context for new or low-context attendees.',
      'Summarize current state, what changed since last touchpoint, and what this meeting must resolve.',
      ['new_stakeholder_present', 'missing_context_reset']
    );
  }

  if (Number(roleCounts.get('decision partner') || 0) > 0 || gapByCode.has('missing_decision_block')) {
    push(
      'decision_block',
      'high',
      'Drive explicit decisions from decision partners.',
      'Present 2-3 concrete options with tradeoffs, then request a named decision owner and timestamp.',
      ['decision_partner_present', 'missing_decision_block']
    );
  }

  if (signalByCode.has('high_individual_risk') || gapByCode.has('missing_risk_mitigation')) {
    push(
      'risk_objection_block',
      'high',
      'Surface objections and lock mitigation commitments.',
      'Run a dedicated risk/objection round: top objections, mitigation owner, and follow-up checkpoint.',
      ['high_individual_risk', 'missing_risk_mitigation']
    );
  }

  if (signalByCode.has('rsvp_unconfirmed') || signalByCode.has('rsvp_declined') || gapByCode.has('missing_rsvp_alignment')) {
    push(
      'attendance_alignment',
      'medium',
      'Stabilize participation and alignment risks.',
      'Confirm attendee commitments, fallback delegates, and asynchronous handoff plan before closing.',
      ['rsvp_instability', 'missing_rsvp_alignment']
    );
  }

  if (roleByCode.has('role_execution_owner') || hasKeyword(title, ['kickoff', 'sync', 'review'])) {
    push(
      'execution_handoff',
      'medium',
      'Convert discussion into execution owners.',
      'Assign task owner/date per action item and confirm dependencies out loud.',
      ['execution_handoff']
    );
  }

  push(
    'close_with_commitments',
    'high',
    'Close with explicit commitments and next checkpoints.',
    'Recap decisions, owners, and due dates; confirm distribution channel and follow-up cadence.',
    ['closeout']
  );

  return sequence
    .slice(0, 7)
    .map((point, idx) => ({
      order: idx + 1,
      ...point,
    }));
}

function buildObjectionRebuttalPacks({ attendees }) {
  const packs = [];
  for (const attendee of attendees || []) {
    const riskLevel = String(attendee?.relationshipRisk?.level || 'low');
    const role = String(attendee?.roleProfile?.role || 'observer');
    const response = String(attendee?.responseStatus || '').toLowerCase();
    const include =
      riskLevel !== 'low'
      || response === 'tentative'
      || response === 'needsaction'
      || response === 'declined'
      || role === 'at-risk stakeholder'
      || role === 'blocked stakeholder'
      || role === 'new stakeholder';
    if (!include) continue;

    const objections = buildAttendeeObjections(attendee);
    if (!objections.length) continue;
    packs.push({
      attendeeEmail: attendee.email,
      attendeeName: attendee.name,
      priority: riskLevel === 'high' || response === 'declined' ? 'high' : 'medium',
      objections: objections.slice(0, 3),
    });
  }

  return packs.sort((a, b) => {
    const pa = a.priority === 'high' ? 0 : 1;
    const pb = b.priority === 'high' ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return String(a.attendeeEmail).localeCompare(String(b.attendeeEmail));
  });
}

function buildStakeholderIntentSummaries({ attendees }) {
  const summaries = [];
  for (const attendee of attendees || []) {
    const intent = attendee?.stakeholderIntentSummary;
    if (!intent) continue;
    summaries.push({
      attendeeEmail: attendee.email,
      attendeeName: attendee.name,
      intent: intent.intent,
      approach: intent.approach,
      priority: intent.priority || 'low',
      confidence: intent.confidence || 'low',
      signals: Array.isArray(intent.signals) ? intent.signals.slice(0, 3) : [],
    });
  }

  return summaries.sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 };
    const pa = rank[a.priority] ?? 3;
    const pb = rank[b.priority] ?? 3;
    if (pa !== pb) return pa - pb;
    return String(a.attendeeEmail).localeCompare(String(b.attendeeEmail));
  });
}

function buildNegotiationFallbackPrompts({
  title,
  attendees,
  relationshipRiskSignals,
  agendaGapSignals,
  stakeholderIntentSummaries,
}) {
  const prompts = [];
  const signalByCode = new Map((relationshipRiskSignals || []).map((s) => [s.code, s]));
  const gapByCode = new Map((agendaGapSignals || []).map((g) => [g.code, g]));
  const intentCounts = new Map();
  for (const item of stakeholderIntentSummaries || []) {
    const key = item.intent || 'context validation';
    intentCounts.set(key, (intentCounts.get(key) || 0) + 1);
  }

  const push = (code, priority, trigger, prompt, desiredOutcome, drivers = []) => {
    if (prompts.some((item) => item.code === code)) return;
    prompts.push({
      code,
      priority,
      trigger,
      prompt,
      desiredOutcome,
      drivers: dedupeArray(drivers).slice(0, 4),
    });
  };

  if (signalByCode.has('rsvp_declined') || intentCounts.get('participation flexibility')) {
    push(
      'fallback_delegate_async',
      'high',
      'Attendee cannot commit to live participation.',
      'If real-time participation is blocked, can we name a delegate now and lock an async response deadline today?',
      'Preserve decision velocity despite attendance constraints.',
      ['rsvp_declined', 'participation_flexibility']
    );
  }

  if (signalByCode.has('high_individual_risk') || intentCounts.get('constraint mitigation')) {
    push(
      'fallback_objection_first',
      'high',
      'Stakeholder raises blockers or trust concerns.',
      'What is the single highest-risk constraint we must resolve in this meeting to proceed confidently?',
      'Convert objections into one mitigation owner/date.',
      ['high_individual_risk', 'constraint_mitigation']
    );
  }

  if (gapByCode.has('missing_decision_block') || intentCounts.get('decision closure')) {
    push(
      'fallback_decision_boundary',
      'high',
      'Discussion circles without a decision.',
      'If full approval is not possible now, what minimum decision boundary can we close before ending?',
      'Secure partial decision closure with explicit owner.',
      ['missing_decision_block', 'decision_closure']
    );
  }

  if (gapByCode.has('missing_context_reset') || intentCounts.get('scope clarity') || intentCounts.get('context validation')) {
    push(
      'fallback_scope_reset',
      'medium',
      'Stakeholder indicates unclear context or scope.',
      'Let us pause for a 60-second reset: current state, target outcome, and what is out of scope. Does that align?',
      'Restore shared context before negotiating commitments.',
      ['missing_context_reset', 'scope_clarity']
    );
  }

  if (intentCounts.get('evidence confidence')) {
    push(
      'fallback_evidence_checkpoint',
      'medium',
      'Stakeholder requests more proof before committing.',
      'What exact evidence would make this a yes, and by when can we provide it?',
      'Define objective proof requirements and deadline.',
      ['evidence_confidence']
    );
  }

  if (hasKeyword(title, ['kickoff', 'review', 'sync']) || (attendees || []).length >= 2) {
    push(
      'fallback_closeout',
      'medium',
      'Meeting is close to ending without clear ownership.',
      'Before we close, can we confirm one owner, one due date, and one follow-up checkpoint per open item?',
      'Prevent unresolved closeout drift.',
      ['meeting_closeout']
    );
  }

  if (!prompts.length) {
    push(
      'fallback_default',
      'low',
      'General resistance to plan progression.',
      'What would make this plan actionable enough to commit to one next step today?',
      'Capture one concrete next-step commitment.',
      ['default']
    );
  }

  return prompts.slice(0, 6);
}

function buildCommitmentCloseChecklist({
  title,
  attendees,
  relationshipRiskSignals,
  agendaGapSignals,
  talkingPointSequence,
  stakeholderIntentSummaries,
}) {
  const items = [];
  const signalByCode = new Map((relationshipRiskSignals || []).map((s) => [s.code, s]));
  const gapByCode = new Map((agendaGapSignals || []).map((g) => [g.code, g]));
  const sequenceByCode = new Map((talkingPointSequence || []).map((s) => [s.code, s]));
  const intentCounts = new Map();
  for (const summary of stakeholderIntentSummaries || []) {
    const key = summary?.intent || 'context validation';
    intentCounts.set(key, (intentCounts.get(key) || 0) + 1);
  }

  const push = (code, priority, check, why, ownerHint) => {
    if (items.some((item) => item.code === code)) return;
    items.push({ code, priority, check, why, ownerHint });
  };

  push(
    'closeout_owner_date',
    'high',
    'Confirm one owner + due date per open item before meeting close.',
    'Prevents unresolved execution drift after the call.',
    'Meeting owner'
  );

  if (sequenceByCode.has('decision_block') || gapByCode.has('missing_decision_block')) {
    push(
      'decision_lock',
      'high',
      'Capture explicit decision outcome (approved / deferred / blocked) with named decision owner.',
      'Decision-partner context requires clear closure state.',
      'Primary decision partner'
    );
  }

  if (signalByCode.has('high_individual_risk') || gapByCode.has('missing_risk_mitigation') || intentCounts.get('constraint mitigation')) {
    push(
      'risk_mitigation_commitment',
      'high',
      'Assign one mitigation owner/date for each high-risk objection surfaced.',
      'High relationship-risk signals need concrete mitigation accountability.',
      'Risk/objection owner'
    );
  }

  if (signalByCode.has('rsvp_unconfirmed') || signalByCode.has('rsvp_declined')) {
    push(
      'attendance_fallback',
      'medium',
      'Lock delegate or async response deadline for unstable RSVPs.',
      'Protects decision velocity when live attendance is uncertain.',
      'Attendee manager'
    );
  }

  if (gapByCode.has('missing_context_reset') || hasKeyword(title, ['kickoff', 'onboard', 'intro'])) {
    push(
      'context_confirmation',
      'medium',
      'Confirm scope boundaries and success criteria in one closing sentence.',
      'Avoids context mismatch for new/low-context stakeholders.',
      'Facilitator'
    );
  }

  if ((attendees || []).length >= 2) {
    push(
      'followup_channel',
      'medium',
      'Confirm follow-up channel/thread and next checkpoint time.',
      'Ensures every stakeholder sees the same post-meeting plan.',
      'Meeting owner'
    );
  }

  if (!items.length) {
    push(
      'default_close',
      'low',
      'Close with objective recap, owner assignment, and follow-up timestamp.',
      'Default deterministic closeout path.',
      'Meeting owner'
    );
  }

  return items.slice(0, 6);
}

function buildFollowUpDraftPack({
  title,
  startIso,
  attendees,
  relationshipRiskSignals,
  meetingRecommendations,
  commitmentCloseChecklist,
}) {
  const startDate = toIsoOrNull(startIso);
  const subjectDate = startDate ? startDate.slice(0, 10) : 'today';
  const externalCount = Number(attendees?.length || 0);
  const topNames = (attendees || [])
    .map((a) => a?.name || a?.email)
    .filter(Boolean)
    .slice(0, 3);
  const highRiskCount = (relationshipRiskSignals || [])
    .filter((s) => s.severity === 'high')
    .reduce((sum, s) => sum + Number(s.count || 0), 0);
  const unconfirmedCount = (relationshipRiskSignals || [])
    .filter((s) => s.code === 'rsvp_unconfirmed' || s.code === 'rsvp_declined')
    .reduce((sum, s) => sum + Number(s.count || 0), 0);

  const summary = dedupeArray((meetingRecommendations || [])
    .map((rec) => cleanLine(rec?.text || '', 180))
    .filter(Boolean))
    .slice(0, 2)
    .join(' ');

  const asks = dedupeArray((commitmentCloseChecklist || [])
    .filter((item) => item.priority === 'high' || item.priority === 'medium')
    .map((item) => cleanLine(item.check || '', 140)))
    .slice(0, 4);

  const sendBy = highRiskCount > 0 || unconfirmedCount > 0
    ? 'within 2 hours after meeting'
    : 'by end of day';

  const messageLines = [];
  messageLines.push(`Thanks everyone for today${title ? ` (${cleanLine(title, 100)})` : ''}.`);
  if (summary) {
    messageLines.push(`Summary: ${summary}`);
  }
  if (asks.length) {
    messageLines.push(`Commitment checklist: ${asks.join(' | ')}`);
  }
  if (unconfirmedCount > 0) {
    messageLines.push(`Attendance follow-up: ${unconfirmedCount} attendee slot(s) still need delegate/async confirmation.`);
  }
  messageLines.push('Please reply with owner + due date updates in this thread.');

  return {
    subject: cleanLine(`Follow-up (${subjectDate}): ${title || 'Meeting'} - owners and next steps`, 180),
    sendBy,
    summary: summary || 'No elevated recommendations; proceed with standard owner/date closeout.',
    asks,
    recipientsHint: topNames.length
      ? `Primary external attendees: ${topNames.join(', ')}${externalCount > topNames.length ? ` (+${externalCount - topNames.length} more)` : ''}`
      : 'No named external attendees resolved.',
    messageLines: messageLines.slice(0, 6),
  };
}

function buildAttendeeObjections(attendee) {
  const objections = [];
  const snapshot = attendee?.relationshipSnapshot || {};
  const risk = attendee?.relationshipRisk || {};
  const confidence = attendee?.attendeeConfidence || {};
  const role = attendee?.roleProfile || {};
  const response = String(attendee?.responseStatus || '').toLowerCase();
  const lastTouch = snapshot?.lastTouch;

  const push = (code, objection, rebuttal, evidence, nextAsk) => {
    objections.push({ code, objection, rebuttal, evidence, nextAsk });
  };

  if (!lastTouch) {
    push(
      'no_context_history',
      'I do not have enough context to commit.',
      'We can start with a concise context reset and confirm objective fit before asking for commitments.',
      `No prior touchpoint found; 90d touchpoints=${Number(snapshot.touchpoints90d || 0)}.`,
      'Ask for a 2-minute context validation and one confirmed requirement.'
    );
  } else if (Number(snapshot.touchpoints30d || 0) <= 1) {
    push(
      'thin_recent_history',
      'This feels disconnected from recent work.',
      'Anchor discussion on the most recent thread and highlight continuity from prior messages.',
      `Last touch ${lastTouch.date}; 30d touchpoints=${Number(snapshot.touchpoints30d || 0)}.`,
      'Reference last thread and request confirmation of top priority for this meeting.'
    );
  }

  if (response === 'declined' || response === 'tentative' || response === 'needsaction') {
    push(
      'attendance_uncertainty',
      'I am not sure I can fully participate in this meeting.',
      'We can agree on a fallback path now: delegate, async input window, and explicit decision checkpoint.',
      `RSVP status=${response || 'unknown'}.`,
      'Request an attendance decision or delegate name before close of business.'
    );
  }

  if (risk.level === 'high' || role.role === 'at-risk stakeholder' || role.role === 'blocked stakeholder') {
    push(
      'alignment_risk',
      'I am not confident this plan addresses my constraints.',
      'Run an objection-first segment and convert each concern into a named mitigation owner and due date.',
      `Risk=${risk.level || 'low'}; role=${role.role || 'observer'}; signals=${(risk.signals || []).join('; ') || 'none'}.`,
      'Ask for the top blocker and secure one mitigation commitment with owner/date.'
    );
  }

  if (Number(confidence.score || 0) < 45) {
    push(
      'low_confidence',
      'I do not have enough signal to make a strong decision.',
      'Narrow scope to the minimum decision set and define a follow-up data checkpoint.',
      `Confidence score=${Number(confidence.score || 0)} (${confidence.level || 'low'}).`,
      'Ask for a yes/no decision boundary and the exact data needed for final approval.'
    );
  }

  if (role.role === 'new stakeholder') {
    push(
      'new_stakeholder_friction',
      'I just joined this context and need grounding before committing.',
      'Provide a short business context + current state + decision frame before deep execution details.',
      `Role profile=${role.role}; signals=${(role.signals || []).join('; ') || 'none'}.`,
      'Ask for confirmation that scope and success criteria are understood.'
    );
  }

  return dedupeByCode(objections);
}

function normalizeAttendee(row) {
  const metadata = safeJson(row.metadata_json);
  return {
    entityId: row.id,
    email: normalizeEmail(metadata?.email),
    name: cleanLine(metadata?.name || row.title || '', 120) || null,
    responseStatus: cleanLine(metadata?.response_status || '', 32) || null,
  };
}

function eventStartIso(metadata) {
  return toIsoOrNull(metadata?.start) || toIsoOrNull(metadata?.timestamp);
}

function isExternalAttendee(email, accountEmail, internalDomains) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  if (normalized === accountEmail) return false;
  const domain = extractDomain(normalized);
  if (!domain) return true;
  return !internalDomains.includes(domain);
}

function parseTargetDate(raw) {
  if (!raw) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  }

  const match = String(raw).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error('Invalid --date value. Use YYYY-MM-DD.');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error('Invalid --date value. Use YYYY-MM-DD.');
  }

  return { year, month, day };
}

function assertHybridSchemaReady(db) {
  const required = ['entities', 'entity_chunks', 'entity_links'];
  const rows = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name IN (${required.map(() => '?').join(',')})
  `).all(...required);

  const present = new Set(rows.map((r) => r.name));
  const missing = required.filter((name) => !present.has(name));
  if (missing.length) {
    throw new Error(`Missing required tables: ${missing.join(', ')}. Run npm run db:hybrid:init first.`);
  }
}

function hasTable(db, name) {
  const row = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(name);
  return Boolean(row);
}

function getArg(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  return argv[i + 1] || null;
}

function getArgValues(argv, name) {
  const values = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name && argv[i + 1]) values.push(argv[i + 1]);
  }
  return values;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function toSafeInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function normalizeEmail(value) {
  if (!value) return null;
  const email = String(value).trim().toLowerCase();
  return email.includes('@') ? email : null;
}

function normalizeDomain(value) {
  if (!value) return null;
  return String(value).trim().toLowerCase().replace(/^@/, '') || null;
}

function extractDomain(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const idx = normalized.lastIndexOf('@');
  if (idx === -1) return null;
  return normalized.slice(idx + 1);
}

function safeJson(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function toIsoOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function toYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toLocalHm(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '??:??';
  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function cleanLine(value, maxLen = 240) {
  if (!value) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function dedupeArray(values) {
  return [...new Set(values)];
}

function dedupeByCode(items) {
  const byCode = new Map();
  for (const item of items || []) {
    if (!item?.code) continue;
    if (!byCode.has(item.code)) byCode.set(item.code, item);
  }
  return [...byCode.values()];
}

function raiseRisk(current, next) {
  const rank = { low: 0, medium: 1, high: 2 };
  return rank[next] > rank[current] ? next : current;
}

function riskLevelRank(level) {
  const rank = { low: 0, medium: 1, high: 2 };
  return rank[level] ?? 0;
}

function clampInt(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function confidenceLevelFor(score) {
  if (score >= 75) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
}

function hasKeyword(value, needles) {
  const text = String(value || '').toLowerCase();
  for (const needle of needles || []) {
    if (text.includes(String(needle).toLowerCase())) return true;
  }
  return false;
}
