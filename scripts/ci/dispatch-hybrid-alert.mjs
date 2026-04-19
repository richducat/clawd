#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ET_TIMEZONE = "America/New_York";
const WEEKDAY_TO_INDEX = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

function parseList(value) {
  if (!value) return [];
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(items) {
  return [...new Set(items)];
}

function toBoolean(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function toPositiveIntegerOrNull(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed <= 0) return null;
  return Math.floor(parsed);
}

function toNonNegativeIntegerOrNull(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0) return null;
  return Math.floor(parsed);
}

function parseRoutes(singleVar, listVar) {
  const single = process.env[singleVar] ? [String(process.env[singleVar]).trim()] : [];
  const list = parseList(process.env[listVar]);
  const routes = unique([...single, ...list]).filter((url) => /^https?:\/\//i.test(url));
  return routes;
}

function parseTimeToken(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function expandDaySpec(daySpec) {
  const normalized = daySpec.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "*") return [0, 1, 2, 3, 4, 5, 6];

  const result = new Set();
  for (const tokenRaw of normalized.split(",")) {
    const token = tokenRaw.trim();
    if (!token) continue;

    if (token.includes("-")) {
      const [startRaw, endRaw] = token.split("-");
      const start = WEEKDAY_TO_INDEX[startRaw?.trim()];
      const end = WEEKDAY_TO_INDEX[endRaw?.trim()];
      if (start == null || end == null) return null;
      let idx = start;
      while (true) {
        result.add(idx);
        if (idx === end) break;
        idx = (idx + 1) % 7;
      }
      continue;
    }

    const day = WEEKDAY_TO_INDEX[token];
    if (day == null) return null;
    result.add(day);
  }
  return [...result];
}

function parseEscalationWindows(raw) {
  const value = String(raw ?? "always").trim();
  if (!value || value.toLowerCase() === "always") {
    return [{ days: [0, 1, 2, 3, 4, 5, 6], startMins: 0, endMins: 1440, source: "always" }];
  }

  const windows = [];
  for (const chunkRaw of value.split(";")) {
    const chunk = chunkRaw.trim();
    if (!chunk) continue;

    const [daySpec, timeRange] = chunk.split("@");
    if (!daySpec || !timeRange) {
      throw new Error(
        `Invalid escalation window "${chunk}". Expected format: daySpec@HH:MM-HH:MM (example mon-fri@08:00-18:00).`
      );
    }

    const days = expandDaySpec(daySpec);
    if (!days || days.length === 0) {
      throw new Error(`Invalid day spec "${daySpec}" in escalation windows.`);
    }

    const [startRaw, endRaw] = timeRange.split("-");
    const startMins = parseTimeToken(startRaw || "");
    const endMins = parseTimeToken(endRaw || "");
    if (startMins == null || endMins == null) {
      throw new Error(`Invalid time range "${timeRange}" in escalation windows.`);
    }

    windows.push({
      days,
      startMins,
      endMins,
      source: chunk,
    });
  }

  if (windows.length === 0) {
    throw new Error("Escalation windows parsed to zero entries.");
  }

  return windows;
}

function getNowEt() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TIMEZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const weekdayRaw = parts.find((part) => part.type === "weekday")?.value?.toLowerCase() || "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value || "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value || "0");
  const day = WEEKDAY_TO_INDEX[weekdayRaw.slice(0, 3)];
  if (day == null) {
    throw new Error(`Unable to parse ET weekday from formatter output: "${weekdayRaw}"`);
  }

  return {
    day,
    mins: hour * 60 + minute,
    weekday: weekdayRaw.slice(0, 3),
    hhmm: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

function formatEtDateTime(date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function isWindowMatch(window, nowEt) {
  const { days, startMins, endMins } = window;
  if (startMins === endMins) return days.includes(nowEt.day);

  if (startMins < endMins) {
    return days.includes(nowEt.day) && nowEt.mins >= startMins && nowEt.mins < endMins;
  }

  // Overnight window, e.g. 22:00-06:00.
  const previousDay = (nowEt.day + 6) % 7;
  const currentDayInWindow = days.includes(nowEt.day) && nowEt.mins >= startMins;
  const carryOverInWindow = days.includes(previousDay) && nowEt.mins < endMins;
  return currentDayInWindow || carryOverInWindow;
}

function classifyIncident() {
  const driftGateBreached = toBoolean(process.env.ALERT_DRIFT_GATE_BREACHED);
  const driftSignalCount = Number(process.env.ALERT_DRIFT_SIGNAL_COUNT || "0");
  const qualityGateBreached = toBoolean(process.env.ALERT_QUALITY_GATE_BREACHED);
  const qualitySignalCount = Number(process.env.ALERT_QUALITY_DRIFT_SIGNAL_COUNT || "0");
  if (driftGateBreached) {
    return { type: "drift_gate_breach", drift_related: true, quality_related: false, severity: "high" };
  }
  if (qualityGateBreached) {
    return { type: "quality_drift_gate_breach", drift_related: false, quality_related: true, severity: "high" };
  }
  if (Number.isFinite(driftSignalCount) && driftSignalCount > 0) {
    return { type: "drift_signal_detected", drift_related: true, quality_related: false, severity: "medium" };
  }
  if (Number.isFinite(qualitySignalCount) && qualitySignalCount > 0) {
    return { type: "quality_drift_signal_detected", drift_related: false, quality_related: true, severity: "medium" };
  }
  return { type: "health_gate_breach", drift_related: false, quality_related: false, severity: "high" };
}

function readAckEscalationPolicy() {
  const raw = String(process.env.ALERT_ACK_ESCALATION_POLICY_JSON || "").trim();
  if (!raw) return { config: null, parse_error: null };
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) {
      return { config: null, parse_error: "ALERT_ACK_ESCALATION_POLICY_JSON must be a JSON object." };
    }
    return { config: parsed, parse_error: null };
  } catch (error) {
    return { config: null, parse_error: `ALERT_ACK_ESCALATION_POLICY_JSON parse failed: ${error?.message || error}` };
  }
}

function normalizeAckPolicyPatch(value) {
  if (typeof value !== "object" || value == null || Array.isArray(value)) return {};
  const patch = {};
  const sla = toPositiveIntegerOrNull(value.ack_sla_minutes);
  const reminderInterval = toPositiveIntegerOrNull(value.ack_reminder_interval_minutes);
  const escalateAfter = toPositiveIntegerOrNull(value.ack_escalate_after_reminders);
  const staleAfter = toPositiveIntegerOrNull(value.ack_stale_after_minutes);
  if (sla != null) patch.ack_sla_minutes = sla;
  if (reminderInterval != null) patch.ack_reminder_interval_minutes = reminderInterval;
  if (escalateAfter != null) patch.ack_escalate_after_reminders = escalateAfter;
  if (staleAfter != null) patch.ack_stale_after_minutes = staleAfter;
  return patch;
}

function resolveAckPolicy({ incident, runMode, policyConfig }) {
  const defaults = {
    ack_sla_minutes: 45,
    ack_reminder_interval_minutes: 30,
    ack_escalate_after_reminders: 2,
    ack_stale_after_minutes: 1440,
  };

  if (incident.type === "drift_gate_breach") {
    defaults.ack_sla_minutes = 15;
    defaults.ack_reminder_interval_minutes = 15;
    defaults.ack_escalate_after_reminders = 1;
  } else if (incident.type === "quality_drift_gate_breach") {
    defaults.ack_sla_minutes = 20;
    defaults.ack_reminder_interval_minutes = 20;
    defaults.ack_escalate_after_reminders = 1;
  } else if (runMode === "live") {
    defaults.ack_sla_minutes = 20;
  } else if (incident.type === "drift_signal_detected") {
    defaults.ack_sla_minutes = 30;
  } else if (incident.type === "quality_drift_signal_detected") {
    defaults.ack_sla_minutes = 35;
  }

  const applied = ["deterministic_v2_default"];
  let policy = { ...defaults };

  const applyPatch = (label, candidate) => {
    const patch = normalizeAckPolicyPatch(candidate);
    if (!Object.keys(patch).length) return;
    policy = { ...policy, ...patch };
    applied.push(label);
  };

  if (policyConfig) {
    applyPatch("policy.default", policyConfig.default);
    applyPatch(`policy.run_mode.${runMode}`, policyConfig.run_mode?.[runMode]);
    applyPatch(`policy.incident_severity.${incident.severity}`, policyConfig.incident_severity?.[incident.severity]);
    applyPatch(`policy.incident_type.${incident.type}`, policyConfig.incident_type?.[incident.type]);
  }

  const explicitSla = toPositiveIntegerOrNull(process.env.ALERT_ACK_SLA_MINUTES);
  if (explicitSla != null) {
    policy.ack_sla_minutes = explicitSla;
    applied.push("env.ALERT_ACK_SLA_MINUTES");
  }

  const explicitReminderInterval = toPositiveIntegerOrNull(process.env.ALERT_ACK_REMINDER_INTERVAL_MINUTES);
  if (explicitReminderInterval != null) {
    policy.ack_reminder_interval_minutes = explicitReminderInterval;
    applied.push("env.ALERT_ACK_REMINDER_INTERVAL_MINUTES");
  }

  const explicitEscalateAfter = toPositiveIntegerOrNull(process.env.ALERT_ACK_ESCALATE_AFTER_REMINDERS);
  if (explicitEscalateAfter != null) {
    policy.ack_escalate_after_reminders = explicitEscalateAfter;
    applied.push("env.ALERT_ACK_ESCALATE_AFTER_REMINDERS");
  }

  const explicitStaleAfter = toPositiveIntegerOrNull(process.env.ALERT_ACK_STALE_AFTER_MINUTES);
  if (explicitStaleAfter != null) {
    policy.ack_stale_after_minutes = explicitStaleAfter;
    applied.push("env.ALERT_ACK_STALE_AFTER_MINUTES");
  }

  return {
    ...policy,
    ack_policy_name: "deterministic_v2",
    ack_policy_applied: unique(applied),
  };
}

function resolveIncidentAgeProfile(existingIncident) {
  const warningMinutes = toPositiveIntegerOrNull(process.env.ALERT_INCIDENT_AGE_WARNING_MINUTES) ?? 180;
  const criticalMinutes = toPositiveIntegerOrNull(process.env.ALERT_INCIDENT_AGE_CRITICAL_MINUTES) ?? 720;
  const effectiveCriticalMinutes = criticalMinutes > warningMinutes ? criticalMinutes : warningMinutes + 1;

  const firstSeenAtUtc = toIsoOrNull(existingIncident?.first_seen_at_utc);
  const ageMinutesRaw = toNonNegativeIntegerOrNull(minutesSince(firstSeenAtUtc));
  const ageMinutes = ageMinutesRaw ?? 0;

  let band = "new";
  if (firstSeenAtUtc != null) {
    if (ageMinutes >= effectiveCriticalMinutes) {
      band = "critical";
    } else if (ageMinutes >= warningMinutes) {
      band = "aging";
    } else {
      band = "fresh";
    }
  }

  return {
    first_seen_at_utc: firstSeenAtUtc,
    age_minutes: ageMinutes,
    band,
    warning_minutes: warningMinutes,
    critical_minutes: effectiveCriticalMinutes,
    escalation_due: firstSeenAtUtc != null && ageMinutes >= warningMinutes,
  };
}

function applyIncidentAgePolicy({ policy, applied, ageProfile, incident, policyConfig }) {
  let nextPolicy = { ...policy };
  const nextApplied = [...applied];

  const applyPatch = (label, candidate) => {
    const patch = normalizeAckPolicyPatch(candidate);
    if (!Object.keys(patch).length) return;
    nextPolicy = { ...nextPolicy, ...patch };
    nextApplied.push(label);
  };

  if (incident.quality_related) {
    if (ageProfile.band === "aging") {
      nextPolicy.ack_sla_minutes = Math.min(nextPolicy.ack_sla_minutes, 20);
      nextPolicy.ack_reminder_interval_minutes = Math.min(nextPolicy.ack_reminder_interval_minutes, 15);
      nextPolicy.ack_escalate_after_reminders = Math.min(nextPolicy.ack_escalate_after_reminders, 2);
      nextApplied.push("deterministic_v2_quality_age.aging");
    } else if (ageProfile.band === "critical") {
      nextPolicy.ack_sla_minutes = Math.min(nextPolicy.ack_sla_minutes, 10);
      nextPolicy.ack_reminder_interval_minutes = Math.min(nextPolicy.ack_reminder_interval_minutes, 10);
      nextPolicy.ack_escalate_after_reminders = Math.min(nextPolicy.ack_escalate_after_reminders, 1);
      nextApplied.push("deterministic_v2_quality_age.critical");
    }
  }

  if (policyConfig) {
    applyPatch(`policy.incident_age_band.${ageProfile.band}`, policyConfig.incident_age_band?.[ageProfile.band]);
  }

  return {
    policy: nextPolicy,
    applied: unique(nextApplied),
  };
}

function sha1(value) {
  return crypto.createHash("sha1").update(value).digest("hex");
}

function toIsoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function parseJsonList(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed.map((item) => String(item).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function parseAckEvidenceTokens(value) {
  return unique([
    ...parseList(value),
    ...parseJsonList(value),
  ]).filter(Boolean);
}

function parseAckEvidenceSummary(pathLike) {
  const filePath = String(pathLike || "").trim();
  if (!filePath) return null;
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
    if (typeof parsed !== "object" || parsed == null) return null;
    return parsed;
  } catch {
    return null;
  }
}

function appendGitHubOutput(kvPairs) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;
  const lines = [];
  for (const [key, value] of Object.entries(kvPairs)) {
    const normalized = String(value ?? "");
    if (normalized.includes("\n")) {
      lines.push(`${key}<<EOF`);
      lines.push(normalized);
      lines.push("EOF");
    } else {
      lines.push(`${key}=${normalized}`);
    }
  }
  fs.appendFileSync(outputFile, `${lines.join("\n")}\n`, "utf8");
}

function readAckState(filePath) {
  if (!filePath) return { schema_version: 1, incidents: {} };
  if (!fs.existsSync(filePath)) {
    return { schema_version: 1, incidents: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (typeof parsed !== "object" || parsed == null) {
      return { schema_version: 1, incidents: {} };
    }
    const incidents = typeof parsed.incidents === "object" && parsed.incidents != null ? parsed.incidents : {};
    return {
      schema_version: 1,
      incidents,
      generated_at_utc: toIsoOrNull(parsed.generated_at_utc) || undefined,
    };
  } catch {
    return { schema_version: 1, incidents: {} };
  }
}

function writeAckState(filePath, state) {
  if (!filePath) return;
  const outPath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        schema_version: 1,
        generated_at_utc: new Date().toISOString(),
        incidents: state.incidents,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

function minutesSince(iso) {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return Math.floor((Date.now() - date.getTime()) / (60 * 1000));
}

function buildAckKey({ incident, runMode, runDate, repo, branch }) {
  return `${runMode}:${incident.type}:${runDate || "unknown"}:${repo || "unknown"}:${branch || "unknown"}`;
}

function buildAckMarker({ ackKey, ackPolicy }) {
  const now = new Date();
  const dueAt = new Date(now.getTime() + ackPolicy.ack_sla_minutes * 60 * 1000);
  const marker = `ack-${sha1(ackKey).slice(0, 16)}`;
  return {
    ack_key: ackKey,
    ack_required: true,
    ack_policy: ackPolicy.ack_policy_name,
    ack_policy_applied: ackPolicy.ack_policy_applied,
    ack_marker: marker,
    ack_sla_minutes: ackPolicy.ack_sla_minutes,
    ack_due_at_utc: dueAt.toISOString(),
    ack_due_at_et: formatEtDateTime(dueAt),
  };
}

function buildEscalationSummary({
  incident,
  nowEt,
  escalationEnabled,
  driftEscalationEnabled,
  qualityEscalationEnabled,
  escalationWindows,
  baseRoutes,
  escalationRoutes,
  driftRoutes,
  driftEscalationRoutes,
  qualityRoutes,
  qualityEscalationRoutes,
  ackReminderRoutes,
  ackReminderEscalationRoutes,
  reminderSummary,
  incidentAgeProfile,
}) {
  const reminderEscalationDueCount = reminderSummary.filter((item) => item.reminder_escalation_due).length;
  return {
    schema_version: 1,
    policy: {
      windows_et: escalationWindows.map((window) => window.source),
      et_now: `${nowEt.weekday}@${nowEt.hhmm}`,
      incident_type: incident.type,
      incident_drift_related: incident.drift_related,
      incident_quality_related: incident.quality_related,
      incident_age_band: incidentAgeProfile.band,
      incident_age_minutes: incidentAgeProfile.age_minutes,
      incident_age_warning_minutes: incidentAgeProfile.warning_minutes,
      incident_age_critical_minutes: incidentAgeProfile.critical_minutes,
      incident_age_escalation_due: incidentAgeProfile.escalation_due,
    },
    routes: {
      base_configured_count: baseRoutes.length,
      escalation_configured_count: escalationRoutes.length,
      drift_configured_count: driftRoutes.length,
      drift_escalation_configured_count: driftEscalationRoutes.length,
      quality_configured_count: qualityRoutes.length,
      quality_escalation_configured_count: qualityEscalationRoutes.length,
      ack_reminder_configured_count: ackReminderRoutes.length,
      ack_reminder_escalation_configured_count: ackReminderEscalationRoutes.length,
      escalation_enabled: escalationEnabled,
      drift_escalation_enabled: driftEscalationEnabled,
      quality_escalation_enabled: qualityEscalationEnabled,
      reminder_escalation_due_count: reminderEscalationDueCount,
    },
  };
}

function toDigestMarkdown(digest) {
  const lines = [
    "# ACK Reminder Digest",
    "",
    `- Generated (UTC): \`${digest.generated_at_utc}\``,
    `- Run mode: \`${digest.run_mode}\``,
    `- Run date: \`${digest.run_date}\``,
    `- Incident type: \`${digest.incident_type}\``,
    `- ACK key: \`${digest.ack.ack_key}\``,
    `- ACK marker: \`${digest.ack.ack_marker}\``,
    `- Incident age: \`${digest.ack.incident_age_minutes}m (${digest.ack.incident_age_band})\``,
    `- ACK required: \`${digest.ack.ack_required}\``,
    `- ACK reconciled: \`${digest.ack.reconciled}\``,
    `- ACK due (UTC): \`${digest.ack.ack_due_at_utc}\``,
    `- ACK due (ET): \`${digest.ack.ack_due_at_et}\``,
    `- Reminders due now: \`${digest.reminders.due_count}\``,
    `- Reminder escalations due now: \`${digest.reminders.escalations_due_count}\``,
    `- Stale ACK pending: \`${digest.stale.stale_pending_count}\``,
    `- Newly stale this run: \`${digest.stale.newly_stale_count}\``,
    `- Evidence active markers: \`${digest.evidence.active_marker_count}\``,
    `- Evidence active keys: \`${digest.evidence.active_key_count}\``,
    `- Evidence stale entries: \`${digest.evidence.stale_entry_count}\``,
    `- Evidence parse errors: \`${digest.evidence.parse_error_count}\``,
    "",
    "## Escalation Summary Contract",
    `- ET window now: \`${digest.escalation.policy.et_now}\``,
    `- Escalation windows: \`${digest.escalation.policy.windows_et.join(";") || "n/a"}\``,
    `- Incident age escalation due: \`${digest.escalation.policy.incident_age_escalation_due}\``,
    `- Escalation enabled: \`${digest.escalation.routes.escalation_enabled}\``,
    `- Drift escalation enabled: \`${digest.escalation.routes.drift_escalation_enabled}\``,
    `- Quality escalation enabled: \`${digest.escalation.routes.quality_escalation_enabled}\``,
    `- Base routes configured: \`${digest.escalation.routes.base_configured_count}\``,
    `- Escalation routes configured: \`${digest.escalation.routes.escalation_configured_count}\``,
    `- Drift routes configured: \`${digest.escalation.routes.drift_configured_count}\``,
    `- Drift escalation routes configured: \`${digest.escalation.routes.drift_escalation_configured_count}\``,
    `- Quality routes configured: \`${digest.escalation.routes.quality_configured_count}\``,
    `- Quality escalation routes configured: \`${digest.escalation.routes.quality_escalation_configured_count}\``,
    `- ACK reminder routes configured: \`${digest.escalation.routes.ack_reminder_configured_count}\``,
    `- ACK reminder escalation routes configured: \`${digest.escalation.routes.ack_reminder_escalation_configured_count}\``,
    `- Reminder escalations due count: \`${digest.escalation.routes.reminder_escalation_due_count}\``,
  ];

  if (digest.reminders.samples.length > 0) {
    lines.push("", "## Reminder Samples");
    for (const reminder of digest.reminders.samples) {
      lines.push(
        `- key=\`${reminder.ack_key}\` marker=\`${reminder.ack_marker}\` overdue=\`${reminder.overdue_minutes}m\` reminders=\`${reminder.reminder_count}\` escalation_due=\`${reminder.reminder_escalation_due}\``
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function buildAlertText({
  escalationEnabled,
  driftEscalationEnabled,
  qualityEscalationEnabled,
  incident,
  ackMarker,
  reminderSummary,
  ackStatePath,
  staleSummary,
  ackEvidenceSummary,
  escalationSummary,
  incidentAgeProfile,
}) {
  const mode = process.env.RUN_MODE || "unknown";
  const repo = process.env.REPO || "unknown";
  const branch = process.env.BRANCH_REF || "unknown";
  const runDate = process.env.RUN_DATE || "unknown";
  const runUrl = process.env.RUN_URL || "";
  const artifactLabel = process.env.ARTIFACT_LABEL || `hybrid-daily-${mode}-${runDate}`;
  const lag = process.env.MAX_LAG_HOURS || "n/a";
  const drift = process.env.MAX_SEEN_DRIFT_HOURS || "n/a";
  const artifactIssues = process.env.MAX_ARTIFACT_ISSUES || "n/a";
  const approvalRequired = String(process.env.ALERT_APPROVAL_REQUIRED || "").trim().toLowerCase();
  const approvalEnvironment = process.env.ALERT_APPROVAL_ENVIRONMENT || "";
  const approvalTriggeringActor = process.env.ALERT_APPROVAL_TRIGGER_ACTOR || "";
  const approvalDispatchActor = process.env.ALERT_APPROVAL_DISPATCH_ACTOR || "";
  const breakGlass = String(process.env.ALERT_BREAK_GLASS || "").trim().toLowerCase();
  const breakGlassReason = process.env.ALERT_BREAK_GLASS_REASON || "";
  const emergencyStop = String(process.env.ALERT_EMERGENCY_STOP || "").trim().toLowerCase();
  const ledgerJson = process.env.ALERT_INCIDENT_LEDGER_JSON || "";
  const ledgerMd = process.env.ALERT_INCIDENT_LEDGER_MD || "";
  const driftStatus = process.env.ALERT_DRIFT_STATUS || "";
  const driftSignals = process.env.ALERT_DRIFT_SIGNAL_COUNT || "";
  const driftTotalSeverityScore = process.env.ALERT_DRIFT_TOTAL_SEVERITY_SCORE || "";
  const driftGateBreached = process.env.ALERT_DRIFT_GATE_BREACHED || "";
  const driftGateBreachedBySignalCount = process.env.ALERT_DRIFT_GATE_BREACHED_BY_SIGNAL_COUNT || "";
  const driftGateBreachedBySeverityScore = process.env.ALERT_DRIFT_GATE_BREACHED_BY_SEVERITY_SCORE || "";
  const driftJson = process.env.ALERT_DRIFT_JSON || "";
  const driftMd = process.env.ALERT_DRIFT_MD || "";
  const qualitySignals = process.env.ALERT_QUALITY_DRIFT_SIGNAL_COUNT || "";
  const qualitySeverityScore = process.env.ALERT_QUALITY_SEVERITY_SCORE || "";
  const qualityGateBreached = process.env.ALERT_QUALITY_GATE_BREACHED || "";
  const qualityTopLane = process.env.ALERT_QUALITY_TOP_LANE || "";
  const qualityTopLaneSeverity = process.env.ALERT_QUALITY_TOP_LANE_SEVERITY || "";

  const lines = [
    ":rotating_light: Hybrid daily pipeline health gate breached",
    `Incident type: ${incident.type}`,
    `Mode: ${mode}`,
    `Repo: ${repo}`,
    `Branch: ${branch}`,
    `Run date: ${runDate}`,
    `Thresholds: lag<=${lag}h, drift<=${drift}h, artifactIssues<=${artifactIssues}`,
    `Incident age: band=${incidentAgeProfile.band}, age=${incidentAgeProfile.age_minutes}m, warning>=${incidentAgeProfile.warning_minutes}m, critical>=${incidentAgeProfile.critical_minutes}m, escalationDue=${incidentAgeProfile.escalation_due}`,
    `ACK: key=${ackMarker.ack_key}, marker=${ackMarker.ack_marker}, required=true, policy=${ackMarker.ack_policy}, sla=${ackMarker.ack_sla_minutes}m, due_utc=${ackMarker.ack_due_at_utc}, due_et=${ackMarker.ack_due_at_et}`,
  ];
  if (escalationEnabled) {
    lines.push("Escalation: ACTIVE (inside configured ET window)");
  }
  if (driftEscalationEnabled) {
    lines.push("Drift escalation: ACTIVE (inside configured ET window)");
  }
  if (qualityEscalationEnabled) {
    lines.push("Quality escalation: ACTIVE (inside configured ET window)");
  }
  if (
    approvalRequired === "true" ||
    approvalEnvironment ||
    approvalTriggeringActor ||
    approvalDispatchActor ||
    breakGlass ||
    emergencyStop
  ) {
    lines.push(
      `Approval context: required=${approvalRequired === "true" ? "true" : "unknown"}, env=${approvalEnvironment || "n/a"}, triggeringActor=${approvalTriggeringActor || "n/a"}, dispatchActor=${approvalDispatchActor || "n/a"}`
    );
    lines.push(
      `Emergency controls: stop=${emergencyStop || "n/a"}, breakGlass=${breakGlass || "n/a"}, reason=${breakGlassReason || "n/a"}`
    );
  }
  lines.push(`Run: ${runUrl}`);
  lines.push(`Artifacts: ${artifactLabel} (see run page)`);
  if (ledgerJson || ledgerMd) {
    lines.push(`Incident ledger: json=${ledgerJson || "n/a"}, md=${ledgerMd || "n/a"}`);
  }
  if (
    qualitySignals ||
    qualitySeverityScore ||
    qualityGateBreached ||
    qualityTopLane ||
    qualityTopLaneSeverity ||
    incident.quality_related
  ) {
    lines.push(
      `Meeting-prep quality drift: signals=${qualitySignals || "n/a"}, severityScore=${qualitySeverityScore || "n/a"}, gateBreached=${qualityGateBreached || "n/a"}, topLane=${qualityTopLane || "n/a"}, topLaneSeverity=${qualityTopLaneSeverity || "n/a"}`
    );
  }
  if (
    driftStatus ||
    driftSignals ||
    driftTotalSeverityScore ||
    driftGateBreached ||
    driftGateBreachedBySignalCount ||
    driftGateBreachedBySeverityScore ||
    driftJson ||
    driftMd
  ) {
    lines.push(
      `Canary-vs-live drift: status=${driftStatus || "n/a"}, signals=${driftSignals || "n/a"}, totalSeverityScore=${driftTotalSeverityScore || "n/a"}, gateBreached=${driftGateBreached || "n/a"}, gateBySignalCount=${driftGateBreachedBySignalCount || "n/a"}, gateBySeverityScore=${driftGateBreachedBySeverityScore || "n/a"}`
    );
    lines.push(`Drift evidence: json=${driftJson || "n/a"}, md=${driftMd || "n/a"}`);
  }
  if (reminderSummary.length > 0) {
    lines.push(`ACK reminders due: ${reminderSummary.length}`);
    for (const reminder of reminderSummary.slice(0, 5)) {
      lines.push(
        `- ${reminder.ack_key} marker=${reminder.ack_marker} overdue=${reminder.overdue_minutes}m reminders=${reminder.reminder_count}`
      );
    }
  }
  if (staleSummary.stale_pending_count > 0) {
    lines.push(
      `ACK stale expiry: stalePending=${staleSummary.stale_pending_count}, staleAfter=${staleSummary.stale_after_minutes}m, newlyStale=${staleSummary.newly_stale_count}`
    );
  }
  if (ackEvidenceSummary) {
    lines.push(
      `ACK evidence ingest: activeMarkers=${ackEvidenceSummary.active_marker_count || 0}, activeKeys=${ackEvidenceSummary.active_key_count || 0}, staleEntries=${ackEvidenceSummary.stale_entry_count || 0}, parseErrors=${ackEvidenceSummary.parse_error_count || 0}`
    );
  }
  if (escalationSummary) {
    lines.push(
      `Escalation summary: baseRoutes=${escalationSummary.routes.base_configured_count}, escalationRoutes=${escalationSummary.routes.escalation_configured_count}, driftRoutes=${escalationSummary.routes.drift_configured_count}, driftEscalationRoutes=${escalationSummary.routes.drift_escalation_configured_count}, qualityRoutes=${escalationSummary.routes.quality_configured_count}, qualityEscalationRoutes=${escalationSummary.routes.quality_escalation_configured_count}, reminderEscalationDue=${escalationSummary.routes.reminder_escalation_due_count}`
    );
  }
  if (ackStatePath) {
    lines.push(`ACK state file: ${ackStatePath}`);
  }
  if (process.env.ALERT_ACK_EVIDENCE_JSON) {
    lines.push(`ACK evidence artifact: ${process.env.ALERT_ACK_EVIDENCE_JSON}`);
  }
  return lines.join("\n");
}

async function postToRoute(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Route ${url} failed with status ${response.status}. Body: ${body.slice(0, 300)}`);
  }
}

async function main() {
  const baseRoutes = parseRoutes("ALERT_WEBHOOK_URL", "ALERT_WEBHOOK_URLS");
  const escalationRoutes = parseRoutes("ALERT_ESCALATION_WEBHOOK_URL", "ALERT_ESCALATION_WEBHOOK_URLS");
  const driftRoutes = parseRoutes("ALERT_DRIFT_WEBHOOK_URL", "ALERT_DRIFT_WEBHOOK_URLS");
  const driftEscalationRoutes = parseRoutes("ALERT_DRIFT_ESCALATION_WEBHOOK_URL", "ALERT_DRIFT_ESCALATION_WEBHOOK_URLS");
  const qualityRoutes = parseRoutes("ALERT_QUALITY_WEBHOOK_URL", "ALERT_QUALITY_WEBHOOK_URLS");
  const qualityEscalationRoutes = parseRoutes(
    "ALERT_QUALITY_ESCALATION_WEBHOOK_URL",
    "ALERT_QUALITY_ESCALATION_WEBHOOK_URLS"
  );
  const ackReminderRoutes = parseRoutes("ALERT_ACK_REMINDER_WEBHOOK_URL", "ALERT_ACK_REMINDER_WEBHOOK_URLS");
  const ackReminderEscalationRoutes = parseRoutes(
    "ALERT_ACK_REMINDER_ESCALATION_WEBHOOK_URL",
    "ALERT_ACK_REMINDER_ESCALATION_WEBHOOK_URLS"
  );
  const nowEt = getNowEt();
  const incident = classifyIncident();
  const runMode = String(process.env.RUN_MODE || "unknown");
  const runDate = String(process.env.RUN_DATE || "");
  const repo = String(process.env.REPO || "unknown");
  const branch = String(process.env.BRANCH_REF || "unknown");
  const ackStatePath = String(process.env.ALERT_ACK_STATE_PATH || "").trim();
  const ackState = readAckState(ackStatePath);
  const ackPolicyConfig = readAckEscalationPolicy();
  const ackKey = buildAckKey({ incident, runMode, runDate, repo, branch });
  const existing = ackState.incidents[ackKey];
  const incidentAgeProfile = resolveIncidentAgeProfile(existing);
  const ackPolicy = resolveAckPolicy({
    incident,
    runMode,
    policyConfig: ackPolicyConfig.config,
  });
  const agePolicyOverlay = applyIncidentAgePolicy({
    policy: ackPolicy,
    applied: ackPolicy.ack_policy_applied,
    ageProfile: incidentAgeProfile,
    incident,
    policyConfig: ackPolicyConfig.config,
  });
  ackPolicy.ack_sla_minutes = agePolicyOverlay.policy.ack_sla_minutes;
  ackPolicy.ack_reminder_interval_minutes = agePolicyOverlay.policy.ack_reminder_interval_minutes;
  ackPolicy.ack_escalate_after_reminders = agePolicyOverlay.policy.ack_escalate_after_reminders;
  ackPolicy.ack_stale_after_minutes = agePolicyOverlay.policy.ack_stale_after_minutes;
  ackPolicy.ack_policy_applied = agePolicyOverlay.applied;
  const ackMarker = buildAckMarker({ ackKey, ackPolicy });
  const ackReminderIntervalMinutes = ackPolicy.ack_reminder_interval_minutes;
  const ackEscalateAfterReminders = ackPolicy.ack_escalate_after_reminders;
  const ackStaleAfterMinutes = ackPolicy.ack_stale_after_minutes;
  const ackEvidenceMarkers = new Set(parseAckEvidenceTokens(process.env.ALERT_ACK_EVIDENCE_MARKERS));
  const ackEvidenceKeys = new Set(parseAckEvidenceTokens(process.env.ALERT_ACK_EVIDENCE_KEYS));
  const ackEvidenceSummary = parseAckEvidenceSummary(process.env.ALERT_ACK_EVIDENCE_JSON);
  const nowIso = new Date().toISOString();

  if (ackPolicyConfig.parse_error) {
    console.warn(ackPolicyConfig.parse_error);
  }

  const nextIncident = {
    ack_key: ackKey,
    ack_marker: ackMarker.ack_marker,
    incident_type: incident.type,
    run_mode: runMode,
    run_date: runDate || "unknown",
    repo,
    branch,
    status: "pending",
    first_seen_at_utc: toIsoOrNull(existing?.first_seen_at_utc) || nowIso,
    last_seen_at_utc: nowIso,
    ack_due_at_utc: toIsoOrNull(existing?.ack_due_at_utc) || ackMarker.ack_due_at_utc,
    ack_sla_minutes: ackMarker.ack_sla_minutes,
    acknowledged_at_utc: null,
    acknowledgment_source: "",
    reminder_count: Number(existing?.reminder_count || 0),
    last_reminder_at_utc: toIsoOrNull(existing?.last_reminder_at_utc) || null,
    next_reminder_at_utc: toIsoOrNull(existing?.next_reminder_at_utc) || null,
    incident_age_minutes: incidentAgeProfile.age_minutes,
    incident_age_band: incidentAgeProfile.band,
  };

  if (ackEvidenceMarkers.has(nextIncident.ack_marker) || ackEvidenceKeys.has(nextIncident.ack_key)) {
    nextIncident.status = "acknowledged";
    nextIncident.acknowledged_at_utc = nowIso;
    nextIncident.acknowledgment_source = ackEvidenceMarkers.has(nextIncident.ack_marker)
      ? "ack_marker_evidence"
      : "ack_key_evidence";
    nextIncident.next_reminder_at_utc = null;
  } else if (existing?.status === "acknowledged") {
    nextIncident.status = "acknowledged";
    nextIncident.acknowledged_at_utc = toIsoOrNull(existing?.acknowledged_at_utc) || nowIso;
    nextIncident.acknowledgment_source = existing?.acknowledgment_source || "historical_state";
    nextIncident.next_reminder_at_utc = null;
  }

  ackState.incidents[ackKey] = nextIncident;

  let newlyStaleCount = 0;
  for (const [key, item] of Object.entries(ackState.incidents)) {
    if (key === ackKey) continue;
    if (item?.status !== "pending") continue;
    const lastSeenMinutes = minutesSince(item.last_seen_at_utc || item.first_seen_at_utc);
    if (lastSeenMinutes == null || lastSeenMinutes < ackStaleAfterMinutes) continue;

    item.status = "stale";
    item.stale_at_utc = nowIso;
    item.stale_reason = `last_seen_expired_${ackStaleAfterMinutes}m`;
    item.next_reminder_at_utc = null;
    newlyStaleCount += 1;
  }

  const reminderSummary = [];
  for (const [key, item] of Object.entries(ackState.incidents)) {
    if (item?.status !== "pending") continue;
    const dueMinutes = minutesSince(item.ack_due_at_utc);
    if (dueMinutes == null || dueMinutes < 0) continue;

    const sinceLastReminder =
      item.last_reminder_at_utc == null ? null : Math.max(0, minutesSince(item.last_reminder_at_utc) ?? 0);
    const reminderDue = sinceLastReminder == null || sinceLastReminder >= ackReminderIntervalMinutes;
    if (!reminderDue) continue;

    const nextCount = Number(item.reminder_count || 0) + 1;
    item.reminder_count = nextCount;
    item.last_reminder_at_utc = nowIso;
    item.next_reminder_at_utc = new Date(Date.now() + ackReminderIntervalMinutes * 60 * 1000).toISOString();

    reminderSummary.push({
      ack_key: key,
      ack_marker: item.ack_marker || "n/a",
      overdue_minutes: dueMinutes,
      reminder_count: nextCount,
      reminder_escalation_due: nextCount >= ackEscalateAfterReminders,
    });
  }

  writeAckState(ackStatePath, ackState);

  const stalePendingCount = Object.values(ackState.incidents).filter((item) => item?.status === "stale").length;
  const staleSummary = {
    stale_after_minutes: ackStaleAfterMinutes,
    stale_pending_count: stalePendingCount,
    newly_stale_count: newlyStaleCount,
  };

  const escalationWindows = parseEscalationWindows(process.env.ALERT_ESCALATION_WINDOWS_ET);
  const escalationEnabled = escalationRoutes.length > 0 && escalationWindows.some((window) => isWindowMatch(window, nowEt));
  const driftEscalationEnabled =
    incident.drift_related &&
    driftEscalationRoutes.length > 0 &&
    escalationWindows.some((window) => isWindowMatch(window, nowEt));
  const qualityEscalationEnabled =
    incident.quality_related &&
    qualityEscalationRoutes.length > 0 &&
    escalationWindows.some((window) => isWindowMatch(window, nowEt));
  const escalationSummary = buildEscalationSummary({
    incident,
    nowEt,
    escalationEnabled,
    driftEscalationEnabled,
    qualityEscalationEnabled,
    escalationWindows,
    baseRoutes,
    escalationRoutes,
    driftRoutes,
    driftEscalationRoutes,
    qualityRoutes,
    qualityEscalationRoutes,
    ackReminderRoutes,
    ackReminderEscalationRoutes,
    reminderSummary,
    incidentAgeProfile,
  });

  const destinationRoutes = unique([
    ...baseRoutes,
    ...(escalationEnabled ? escalationRoutes : []),
    ...(incident.drift_related ? driftRoutes : []),
    ...(driftEscalationEnabled ? driftEscalationRoutes : []),
    ...(incident.quality_related ? qualityRoutes : []),
    ...(qualityEscalationEnabled ? qualityEscalationRoutes : []),
    ...(reminderSummary.length > 0 ? ackReminderRoutes : []),
    ...(reminderSummary.some((item) => item.reminder_escalation_due)
      ? ackReminderEscalationRoutes.length > 0
        ? ackReminderEscalationRoutes
        : escalationRoutes
      : []),
  ]);

  const noRoutesConfigured = destinationRoutes.length === 0;

  const payload = {
    text: buildAlertText({
      escalationEnabled,
      driftEscalationEnabled,
      qualityEscalationEnabled,
      incident,
      ackMarker,
    reminderSummary,
    ackStatePath,
    staleSummary,
    ackEvidenceSummary,
    escalationSummary,
    incidentAgeProfile,
  }),
    metadata: {
      incident_type: incident.type,
      incident_severity: incident.severity,
      run_mode: runMode,
      run_date: runDate || "unknown",
      ...ackMarker,
      escalation_summary: escalationSummary,
      ack_state_path: ackStatePath || null,
      ack_reconciled: nextIncident.status === "acknowledged",
      ack_reconciled_at_utc: nextIncident.acknowledged_at_utc || null,
      ack_reconciliation_source: nextIncident.acknowledgment_source || null,
      ack_reminders_due_count: reminderSummary.length,
      ack_reminder_escalations_due_count: reminderSummary.filter((item) => item.reminder_escalation_due).length,
      ack_stale_after_minutes: staleSummary.stale_after_minutes,
      ack_stale_pending_count: staleSummary.stale_pending_count,
      ack_newly_stale_count: staleSummary.newly_stale_count,
      ack_evidence_active_marker_count: Number(ackEvidenceSummary?.active_marker_count || 0),
      ack_evidence_active_key_count: Number(ackEvidenceSummary?.active_key_count || 0),
      ack_evidence_stale_entry_count: Number(ackEvidenceSummary?.stale_entry_count || 0),
      ack_evidence_parse_error_count: Number(ackEvidenceSummary?.parse_error_count || 0),
      ack_evidence_json: process.env.ALERT_ACK_EVIDENCE_JSON || null,
      ack_policy_applied: ackPolicy.ack_policy_applied,
      ack_policy_parse_error: ackPolicyConfig.parse_error,
      incident_age_minutes: incidentAgeProfile.age_minutes,
      incident_age_band: incidentAgeProfile.band,
      incident_age_warning_minutes: incidentAgeProfile.warning_minutes,
      incident_age_critical_minutes: incidentAgeProfile.critical_minutes,
      incident_age_escalation_due: incidentAgeProfile.escalation_due,
      incident_first_seen_at_utc: incidentAgeProfile.first_seen_at_utc,
      quality_drift_signal_count: Number(process.env.ALERT_QUALITY_DRIFT_SIGNAL_COUNT || 0),
      quality_severity_score: Number(process.env.ALERT_QUALITY_SEVERITY_SCORE || 0),
      quality_gate_breached: toBoolean(process.env.ALERT_QUALITY_GATE_BREACHED),
      quality_top_lane: process.env.ALERT_QUALITY_TOP_LANE || null,
      quality_top_lane_severity: process.env.ALERT_QUALITY_TOP_LANE_SEVERITY || null,
    },
  };
  const dryRun = toBoolean(process.env.ALERT_DRY_RUN);

  const summary = {
    routes_total: destinationRoutes.length,
    incident_type: incident.type,
    incident_drift_related: incident.drift_related,
    incident_quality_related: incident.quality_related,
    base_routes: baseRoutes.length,
    escalation_routes: escalationRoutes.length,
    drift_routes: driftRoutes.length,
    drift_escalation_routes: driftEscalationRoutes.length,
    quality_routes: qualityRoutes.length,
    quality_escalation_routes: qualityEscalationRoutes.length,
    ack_reminder_routes: ackReminderRoutes.length,
    ack_reminder_escalation_routes: ackReminderEscalationRoutes.length,
    escalation_enabled: escalationEnabled,
    drift_escalation_enabled: driftEscalationEnabled,
    quality_escalation_enabled: qualityEscalationEnabled,
    escalation_windows: escalationWindows.map((window) => window.source),
    et_now: `${nowEt.weekday}@${nowEt.hhmm}`,
    ack_key: ackMarker.ack_key,
    ack_state_path: ackStatePath || null,
    ack_reconciled: nextIncident.status === "acknowledged",
    ack_reconciled_at_utc: nextIncident.acknowledged_at_utc || null,
    ack_reconciliation_source: nextIncident.acknowledgment_source || null,
    ack_reminders_due_count: reminderSummary.length,
    ack_reminder_escalations_due_count: reminderSummary.filter((item) => item.reminder_escalation_due).length,
    ack_stale_after_minutes: staleSummary.stale_after_minutes,
    ack_stale_pending_count: staleSummary.stale_pending_count,
    ack_newly_stale_count: staleSummary.newly_stale_count,
    ack_sla_minutes: ackMarker.ack_sla_minutes,
    ack_due_at_utc: ackMarker.ack_due_at_utc,
    ack_marker: ackMarker.ack_marker,
    ack_policy: ackMarker.ack_policy,
    ack_policy_applied: ackPolicy.ack_policy_applied,
    ack_policy_parse_error: ackPolicyConfig.parse_error,
    incident_age_minutes: incidentAgeProfile.age_minutes,
    incident_age_band: incidentAgeProfile.band,
    incident_age_warning_minutes: incidentAgeProfile.warning_minutes,
    incident_age_critical_minutes: incidentAgeProfile.critical_minutes,
    incident_age_escalation_due: incidentAgeProfile.escalation_due,
    incident_first_seen_at_utc: incidentAgeProfile.first_seen_at_utc,
    ack_evidence_active_marker_count: Number(ackEvidenceSummary?.active_marker_count || 0),
    ack_evidence_active_key_count: Number(ackEvidenceSummary?.active_key_count || 0),
    ack_evidence_stale_entry_count: Number(ackEvidenceSummary?.stale_entry_count || 0),
    ack_evidence_parse_error_count: Number(ackEvidenceSummary?.parse_error_count || 0),
    ack_evidence_json: process.env.ALERT_ACK_EVIDENCE_JSON || null,
    escalation_summary: escalationSummary,
    dry_run: dryRun,
  };

  const digest = {
    schema_version: 1,
    generated_at_utc: new Date().toISOString(),
    run_mode: runMode,
    run_date: runDate || "unknown",
    incident_type: incident.type,
    incident_severity: incident.severity,
    ack: {
      ack_required: true,
      ack_key: ackMarker.ack_key,
      ack_marker: ackMarker.ack_marker,
      ack_policy: ackMarker.ack_policy,
      ack_policy_applied: ackPolicy.ack_policy_applied,
      ack_policy_parse_error: ackPolicyConfig.parse_error,
      incident_age_minutes: incidentAgeProfile.age_minutes,
      incident_age_band: incidentAgeProfile.band,
      incident_age_warning_minutes: incidentAgeProfile.warning_minutes,
      incident_age_critical_minutes: incidentAgeProfile.critical_minutes,
      incident_age_escalation_due: incidentAgeProfile.escalation_due,
      incident_first_seen_at_utc: incidentAgeProfile.first_seen_at_utc,
      ack_sla_minutes: ackMarker.ack_sla_minutes,
      ack_due_at_utc: ackMarker.ack_due_at_utc,
      ack_due_at_et: ackMarker.ack_due_at_et,
      reconciled: nextIncident.status === "acknowledged",
      reconciled_at_utc: nextIncident.acknowledged_at_utc || null,
      reconciliation_source: nextIncident.acknowledgment_source || null,
      state_path: ackStatePath || null,
    },
    reminders: {
      due_count: reminderSummary.length,
      escalations_due_count: reminderSummary.filter((item) => item.reminder_escalation_due).length,
      samples: reminderSummary.slice(0, 10),
    },
    stale: staleSummary,
    evidence: {
      active_marker_count: Number(ackEvidenceSummary?.active_marker_count || 0),
      active_key_count: Number(ackEvidenceSummary?.active_key_count || 0),
      stale_entry_count: Number(ackEvidenceSummary?.stale_entry_count || 0),
      parse_error_count: Number(ackEvidenceSummary?.parse_error_count || 0),
      evidence_json: process.env.ALERT_ACK_EVIDENCE_JSON || null,
    },
    escalation: escalationSummary,
    routes: {
      total: destinationRoutes.length,
      destinations: destinationRoutes,
    },
  };

  const digestOutDir = path.resolve(String(process.env.ALERT_DIGEST_OUT_DIR || "artifacts"));
  const digestPrefix = String(process.env.ALERT_DIGEST_PREFIX || "ack-reminder-digest").trim() || "ack-reminder-digest";
  const summaryPrefix = String(process.env.ALERT_SUMMARY_PREFIX || "dispatch-alert-summary").trim() || "dispatch-alert-summary";
  fs.mkdirSync(digestOutDir, { recursive: true });
  const fileToken = `${runDate || "unknown"}-${runMode || "unknown"}`;
  const digestJsonPath = path.join(digestOutDir, `${digestPrefix}-${fileToken}.json`);
  const digestMdPath = path.join(digestOutDir, `${digestPrefix}-${fileToken}.md`);
  const summaryJsonPath = path.join(digestOutDir, `${summaryPrefix}-${fileToken}.json`);
  fs.writeFileSync(digestJsonPath, `${JSON.stringify(digest, null, 2)}\n`, "utf8");
  fs.writeFileSync(digestMdPath, toDigestMarkdown(digest), "utf8");
  fs.writeFileSync(summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  appendGitHubOutput({
    ack_digest_json_path: path.relative(process.cwd(), digestJsonPath),
    ack_digest_md_path: path.relative(process.cwd(), digestMdPath),
    dispatch_alert_summary_json_path: path.relative(process.cwd(), summaryJsonPath),
    incident_age_minutes: String(incidentAgeProfile.age_minutes),
    incident_age_band: incidentAgeProfile.band,
    incident_age_escalation_due: String(incidentAgeProfile.escalation_due),
    escalation_enabled: String(escalationEnabled),
    drift_escalation_enabled: String(driftEscalationEnabled),
    ack_reminders_due_count: String(reminderSummary.length),
    ack_reminder_escalations_due_count: String(
      reminderSummary.filter((item) => item.reminder_escalation_due).length
    ),
  });
  console.log(JSON.stringify(summary, null, 2));

  if (noRoutesConfigured) {
    console.log("No alert webhooks configured. Skipping outbound alert dispatch.");
    return;
  }

  if (dryRun) {
    console.log("ALERT_DRY_RUN enabled; no webhooks invoked.");
    return;
  }

  const failures = [];
  for (const route of destinationRoutes) {
    try {
      await postToRoute(route, payload);
      console.log(`Alert sent -> ${route}`);
    } catch (error) {
      failures.push(String(error?.message || error));
      console.error(`Alert failed -> ${route}: ${error?.message || error}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Alert dispatch failed for ${failures.length} route(s).`);
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
