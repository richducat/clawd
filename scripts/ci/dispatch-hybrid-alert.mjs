#!/usr/bin/env node

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

function buildAlertText({ escalationEnabled }) {
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

  const lines = [
    ":rotating_light: Hybrid daily pipeline health gate breached",
    `Mode: ${mode}`,
    `Repo: ${repo}`,
    `Branch: ${branch}`,
    `Run date: ${runDate}`,
    `Thresholds: lag<=${lag}h, drift<=${drift}h, artifactIssues<=${artifactIssues}`,
  ];
  if (escalationEnabled) {
    lines.push("Escalation: ACTIVE (inside configured ET window)");
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
  const nowEt = getNowEt();

  const escalationWindows = parseEscalationWindows(process.env.ALERT_ESCALATION_WINDOWS_ET);
  const escalationEnabled = escalationRoutes.length > 0 && escalationWindows.some((window) => isWindowMatch(window, nowEt));
  const destinationRoutes = unique([...baseRoutes, ...(escalationEnabled ? escalationRoutes : [])]);

  if (destinationRoutes.length === 0) {
    console.log("No alert webhooks configured. Skipping outbound alert dispatch.");
    return;
  }

  const payload = { text: buildAlertText({ escalationEnabled }) };
  const dryRun = String(process.env.ALERT_DRY_RUN || "").toLowerCase() === "1" || String(process.env.ALERT_DRY_RUN || "").toLowerCase() === "true";

  const summary = {
    routes_total: destinationRoutes.length,
    base_routes: baseRoutes.length,
    escalation_routes: escalationRoutes.length,
    escalation_enabled: escalationEnabled,
    escalation_windows: escalationWindows.map((window) => window.source),
    et_now: `${nowEt.weekday}@${nowEt.hhmm}`,
    dry_run: dryRun,
  };
  console.log(JSON.stringify(summary, null, 2));

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
