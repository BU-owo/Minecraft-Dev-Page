const SERVER_ADDRESS = "play.budpe.com:25565";
const TELEMETRY_URL = `https://api.mcsrvstat.us/3/${SERVER_ADDRESS}`;
const ICON_URL = `https://api.mcsrvstat.us/icon/${SERVER_ADDRESS}`;
const ACTIVITY_URL = "https://map.budpe.com/maps/bu_world/live/players.json";
const ACTIVITY_URL_FALLBACK = `https://corsproxy.io/?${encodeURIComponent(ACTIVITY_URL)}`;
const TELEMETRY_POLL_MS = 30_000;
const ACTIVITY_POLL_MS = 5_000;
const TELEMETRY_HISTORY_KEY = "budpeTelemetryHistory";
const TELEMETRY_HISTORY_LIMIT = 250;

const elements = {
  motdSubtitle: document.getElementById("motdSubtitle"),
  onlinePill: document.getElementById("onlinePill"),
  copyIpButton: document.getElementById("copyIpButton"),
  refreshButton: document.getElementById("refreshButton"),
  lastUpdated: document.getElementById("lastUpdated"),
  serverIcon: document.getElementById("serverIcon"),
  playersCount: document.getElementById("playersCount"),
  playersPercent: document.getElementById("playersPercent"),
  playersFill: document.getElementById("playersFill"),
  versionChip: document.getElementById("versionChip"),
  protocolChip: document.getElementById("protocolChip"),
  softwareChip: document.getElementById("softwareChip"),
  detailIp: document.getElementById("detailIp"),
  detailHostname: document.getElementById("detailHostname"),
  detailSoftware: document.getElementById("detailSoftware"),
  debugPing: document.getElementById("debugPing"),
  debugQuery: document.getElementById("debugQuery"),
  debugSrv: document.getElementById("debugSrv"),
  debugCachetime: document.getElementById("debugCachetime"),
  debugAnimatedMotd: document.getElementById("debugAnimatedMotd"),
  detailPort: document.getElementById("detailPort"),
  detailEulaBlocked: document.getElementById("detailEulaBlocked"),
  debugApiVersion: document.getElementById("debugApiVersion"),
  debugCacheHit: document.getElementById("debugCacheHit"),
  debugCacheExpire: document.getElementById("debugCacheExpire"),
  debugBedrock: document.getElementById("debugBedrock"),
  debugQueryMismatch: document.getElementById("debugQueryMismatch"),
  debugIpInSrv: document.getElementById("debugIpInSrv"),
  debugCnameInSrv: document.getElementById("debugCnameInSrv"),
  debugCacheTimeLocal: document.getElementById("debugCacheTimeLocal"),
  debugQueryError: document.getElementById("debugQueryError"),
  debugTelemetryLatency: document.getElementById("debugTelemetryLatency"),
  debugDnsList: document.getElementById("debugDnsList"),
  rawTelemetry: document.getElementById("rawTelemetry"),
  historyTableBody: document.getElementById("historyTableBody"),
  exportHistoryBtn: document.getElementById("exportHistoryBtn"),
  clearHistoryBtn: document.getElementById("clearHistoryBtn"),
  playersList: document.getElementById("playersList"),
  activityFeed: document.getElementById("activityFeed"),
  sparklineCanvas: document.getElementById("playersSparkline"),
  uptimeCanvas: document.getElementById("uptimeChart"),
  playersChartCanvas: document.getElementById("playersChart"),
  issuesChartCanvas: document.getElementById("issuesChart"),
  latencyChartCanvas: document.getElementById("latencyChart"),
};

const state = {
  telemetryReady: false,
  activityReady: false,
  sparkline: {
    chart: null,
    labels: [],
    values: [],
  },
  historyCharts: {
    uptime: null,
    players: null,
    issues: null,
    latency: null,
  },
  activitySnapshot: new Map(),
  activityEvents: [],
  activitySeenKeys: new Set(),
  telemetryHistory: [],
};

function removeLoadingClass(node) {
  if (node) {
    node.classList.remove("loading");
  }
}

function setText(node, value) {
  if (!node) return;
  node.textContent = value;
  removeLoadingClass(node);
}

function formatTimestamp(date = new Date()) {
  return date.toLocaleString(undefined, {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function boolText(value) {
  return value ? "true" : "false";
}

function clamp(number, min, max) {
  return Math.min(Math.max(number, min), max);
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatFromUnixSeconds(value) {
  if (typeof value !== "number") {
    return "unknown";
  }

  return formatTimestamp(new Date(value * 1000));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parsePlayersValue(value) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const match = value.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (match) {
      return Number(match[1]);
    }

    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function parseBooleanValue(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }

  return Boolean(value);
}

function collectTelemetryIssues(data) {
  const issues = [];

  if (!data?.online) issues.push("offline");
  if (!data?.debug?.ping) issues.push("ping");
  if (!data?.debug?.query) issues.push("query");
  if (!data?.debug?.srv) issues.push("srv");
  if (data?.eula_blocked) issues.push("eula");
  if (data?.debug?.bedrock) issues.push("bedrock");
  if (data?.debug?.querymismatch) issues.push("query mismatch");
  if (!data?.debug?.ipinsrv) issues.push("ip in srv");
  if (data?.debug?.cnameinsrv) issues.push("cname in srv");
  if (data?.debug?.error?.query) issues.push("query error");

  return issues;
}

function normalizeTelemetryHistoryItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  return {
    label: item.timestamp ?? formatTimestamp(),
    online: parseBooleanValue(item.online),
    playersOnline: toNumber(item.playersOnline ?? parsePlayersValue(item.players), 0),
    playersMax: toNumber(item.playersMax ?? (typeof item.players === "string" ? Number(item.players.split("/")[1]?.trim()) : 0), 0),
    issueScore: toNumber(item.issueScore ?? (parseBooleanValue(item.online) ? 0 : 1), parseBooleanValue(item.online) ? 0 : 1),
    fetchLatencyMs: item.fetchLatencyMs === "unknown" ? null : item.fetchLatencyMs == null ? null : toNumber(item.fetchLatencyMs, null),
  };
}

function createChart(canvas, config) {
  if (!canvas || typeof Chart === "undefined") {
    return null;
  }

  const context = canvas.getContext("2d");
  return new Chart(context, config);
}

function chartOptions() {
  const gridColor = "rgba(161, 176, 168, 0.14)";
  const tickColor = "#a1b0a8";

  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: "index",
      intersect: false,
    },
    plugins: {
      legend: {
        labels: {
          color: tickColor,
          boxWidth: 12,
          boxHeight: 12,
        },
      },
      tooltip: {
        backgroundColor: "rgba(12, 17, 15, 0.96)",
        borderColor: "rgba(147, 170, 157, 0.2)",
        borderWidth: 1,
        titleColor: "#e9f0ec",
        bodyColor: "#e9f0ec",
      },
    },
    scales: {
      x: {
        ticks: {
          color: tickColor,
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 6,
        },
        grid: {
          color: gridColor,
        },
      },
      y: {
        ticks: {
          color: tickColor,
        },
        grid: {
          color: gridColor,
        },
        beginAtZero: true,
      },
    },
  };
}

function destroyChart(chart) {
  if (chart) {
    chart.destroy();
  }
}

function renderDnsList(records = []) {
  if (!elements.debugDnsList) return;

  elements.debugDnsList.innerHTML = "";

  if (!Array.isArray(records) || records.length === 0) {
    elements.debugDnsList.innerHTML = '<li class="empty-state">No DNS debug records.</li>';
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const record of records) {
    const li = document.createElement("li");
    const type = record?.type ?? "?";
    const name = record?.name ?? "?";
    const value = record?.address ?? record?.cname ?? "?";
    li.innerHTML = `<span class="dns-type">${escapeHtml(type)}</span><span>${escapeHtml(name)} -> ${escapeHtml(value)}</span>`;
    fragment.appendChild(li);
  }

  elements.debugDnsList.appendChild(fragment);
}

function renderRawTelemetry(data) {
  if (!elements.rawTelemetry) return;
  elements.rawTelemetry.textContent = JSON.stringify(data, null, 2);
  removeLoadingClass(elements.rawTelemetry);
}

function saveTelemetryHistory() {
  try {
    localStorage.setItem(TELEMETRY_HISTORY_KEY, JSON.stringify(state.telemetryHistory));
  } catch (error) {
    console.error(error);
  }
}

function loadTelemetryHistory() {
  try {
    const raw = localStorage.getItem(TELEMETRY_HISTORY_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    state.telemetryHistory = parsed.slice(0, TELEMETRY_HISTORY_LIMIT);
  } catch (error) {
    console.error(error);
  }
}

function renderTelemetryHistory() {
  if (!elements.historyTableBody) return;

  elements.historyTableBody.innerHTML = "";

  if (state.telemetryHistory.length === 0) {
    elements.historyTableBody.innerHTML = '<tr><td colspan="8" class="empty-state">No snapshots yet.</td></tr>';
    renderHistoryCharts();
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of state.telemetryHistory.slice(0, 40)) {
    const issueCount = Number.isFinite(Number(item.issueScore)) ? Number(item.issueScore) : 0;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(item.timestamp)}</td>
      <td>${escapeHtml(item.online)}</td>
      <td>${escapeHtml(item.players)}</td>
      <td>${escapeHtml(item.version)}</td>
      <td>${escapeHtml(item.protocol)}</td>
      <td>${escapeHtml(item.cacheHit)}</td>
      <td>${escapeHtml(issueCount)}</td>
      <td>${escapeHtml(item.fetchLatencyMs)}</td>
    `;
    fragment.appendChild(tr);
  }

  elements.historyTableBody.appendChild(fragment);
  renderHistoryCharts();
}

function addTelemetrySnapshot(data, latencyMs) {
  const issues = collectTelemetryIssues(data);
  const snapshot = {
    timestampIso: new Date().toISOString(),
    timestamp: formatTimestamp(),
    online: Boolean(data?.online),
    playersOnline: Number(data?.players?.online ?? 0),
    playersMax: Number(data?.players?.max ?? 0),
    players: `${Number(data?.players?.online ?? 0)} / ${Number(data?.players?.max ?? 0)}`,
    version: data?.version ?? "unknown",
    protocol: String(data?.protocol?.name ?? data?.protocol?.version ?? "unknown"),
    cacheHit: String(Boolean(data?.debug?.cachehit)),
    issueScore: issues.length,
    issueSummary: issues.length > 0 ? issues.join(", ") : "none",
    fetchLatencyMs: typeof latencyMs === "number" ? latencyMs : "unknown",
  };

  state.telemetryHistory.unshift(snapshot);
  if (state.telemetryHistory.length > TELEMETRY_HISTORY_LIMIT) {
    state.telemetryHistory = state.telemetryHistory.slice(0, TELEMETRY_HISTORY_LIMIT);
  }

  saveTelemetryHistory();
  renderTelemetryHistory();
}

function exportTelemetryHistory() {
  if (state.telemetryHistory.length === 0) return;

  const fileName = `budpe-telemetry-history-${new Date().toISOString().replaceAll(":", "-")}.json`;
  const blob = new Blob([JSON.stringify(state.telemetryHistory, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

function clearTelemetryHistory() {
  state.telemetryHistory = [];
  saveTelemetryHistory();
  renderTelemetryHistory();
}

function buildTrendPoints() {
  return state.telemetryHistory
    .slice()
    .reverse()
    .map(normalizeTelemetryHistoryItem)
    .filter(Boolean);
}

function buildRollingSeries(values, windowSize) {
  return values.map((value, index) => {
    const start = Math.max(0, index - windowSize + 1);
    const window = values.slice(start, index + 1);
    const total = window.reduce((sum, entry) => sum + entry, 0);
    return window.length > 0 ? total / window.length : value;
  });
}

function renderHistoryCharts() {
  const points = buildTrendPoints();

  destroyChart(state.historyCharts.uptime);
  destroyChart(state.historyCharts.players);
  destroyChart(state.historyCharts.issues);
  destroyChart(state.historyCharts.latency);

  if (points.length === 0) {
    state.historyCharts.uptime = createChart(elements.uptimeCanvas, { type: "line", data: { labels: [], datasets: [] }, options: chartOptions() });
    state.historyCharts.players = createChart(elements.playersChartCanvas, { type: "line", data: { labels: [], datasets: [] }, options: chartOptions() });
    state.historyCharts.issues = createChart(elements.issuesChartCanvas, { type: "line", data: { labels: [], datasets: [] }, options: chartOptions() });
    state.historyCharts.latency = createChart(elements.latencyChartCanvas, { type: "line", data: { labels: [], datasets: [] }, options: chartOptions() });
    return;
  }

  const labels = points.map((point) => point.label);
  const uptimeValues = buildRollingSeries(points.map((point) => (point.online ? 1 : 0)), 12).map((value) => Math.round(value * 100));
  const playersOnlineValues = points.map((point) => point.playersOnline);
  const playersMaxValues = points.map((point) => point.playersMax);
  const issueValues = points.map((point) => point.issueScore);
  const latencyValues = points.map((point) => point.fetchLatencyMs);

  const baseOptions = chartOptions();

  state.historyCharts.uptime = createChart(elements.uptimeCanvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Uptime %",
          data: uptimeValues,
          borderColor: "#93cbb0",
          backgroundColor: "rgba(147, 203, 176, 0.16)",
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2,
        },
      ],
    },
    options: {
      ...baseOptions,
      scales: {
        ...baseOptions.scales,
        y: {
          ...baseOptions.scales.y,
          max: 100,
          ticks: {
            color: "#a1b0a8",
            callback: (value) => `${value}%`,
          },
        },
      },
    },
  });

  state.historyCharts.players = createChart(elements.playersChartCanvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Players Online",
          data: playersOnlineValues,
          borderColor: "#6ba7d8",
          backgroundColor: "rgba(107, 167, 216, 0.16)",
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 2,
        },
        {
          label: "Max Capacity",
          data: playersMaxValues,
          borderColor: "#d8f5c7",
          backgroundColor: "rgba(216, 245, 199, 0.08)",
          fill: false,
          tension: 0.2,
          pointRadius: 0,
          borderWidth: 1.5,
          borderDash: [6, 4],
        },
      ],
    },
    options: baseOptions,
  });

  state.historyCharts.issues = createChart(elements.issuesChartCanvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Issue Score",
          data: issueValues,
          borderColor: "#d29a52",
          backgroundColor: "rgba(210, 154, 82, 0.16)",
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 2,
        },
      ],
    },
    options: baseOptions,
  });

  state.historyCharts.latency = createChart(elements.latencyChartCanvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Fetch ms",
          data: latencyValues,
          borderColor: "#d06f6f",
          backgroundColor: "rgba(208, 111, 111, 0.16)",
          fill: true,
          tension: 0.28,
          pointRadius: 0,
          borderWidth: 2,
          spanGaps: true,
        },
      ],
    },
    options: baseOptions,
  });
}

function createSparkline() {
  if (!elements.sparklineCanvas || typeof Chart === "undefined") {
    return;
  }

  const ctx = elements.sparklineCanvas.getContext("2d");
  state.sparkline.chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: state.sparkline.labels,
      datasets: [
        {
          data: state.sparkline.values,
          borderColor: "#8fbf9f",
          borderWidth: 2,
          tension: 0.35,
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: true },
      },
      scales: {
        x: {
          display: false,
        },
        y: {
          display: false,
          beginAtZero: true,
        },
      },
      animation: {
        duration: 250,
      },
    },
  });
}

function pushSparklinePoint(playersOnline) {
  if (!state.sparkline.chart) return;

  const now = new Date();
  const label = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  state.sparkline.labels.push(label);
  state.sparkline.values.push(playersOnline);

  if (state.sparkline.labels.length > 120) {
    state.sparkline.labels.shift();
    state.sparkline.values.shift();
  }

  state.sparkline.chart.update();
}

function renderPlayersList(list = []) {
  elements.playersList.innerHTML = "";

  if (!Array.isArray(list) || list.length === 0) {
    elements.playersList.innerHTML = '<p class="empty-state">No players online.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const username of list) {
    const card = document.createElement("article");
    card.className = "player-card";

    const avatar = document.createElement("img");
    avatar.src = `https://mc-heads.net/avatar/${encodeURIComponent(username)}/32`;
    avatar.width = 32;
    avatar.height = 32;
    avatar.alt = `${username} avatar`;

    const name = document.createElement("span");
    name.textContent = username;

    card.appendChild(avatar);
    card.appendChild(name);
    fragment.appendChild(card);
  }

  elements.playersList.appendChild(fragment);
}

function applyOnlineStatus(online) {
  const pill = elements.onlinePill;
  if (!pill) return;

  pill.classList.remove("pill-online", "pill-offline", "loading");
  pill.classList.add(online ? "pill-online" : "pill-offline");
  pill.textContent = online ? "Online" : "Offline";
}

function renderTelemetry(data, latencyMs) {
  const online = Boolean(data?.online);
  const playersOnline = Number(data?.players?.online ?? 0);
  const playersMax = Number(data?.players?.max ?? 0);
  const playersPercent = playersMax > 0 ? Math.round((playersOnline / playersMax) * 100) : 0;
  const clamped = clamp(playersPercent, 0, 100);

  applyOnlineStatus(online);

  setText(elements.motdSubtitle, data?.motd?.clean?.[0] ?? "No MOTD available");
  setText(elements.playersCount, `Players: ${playersOnline} / ${playersMax}`);
  setText(elements.playersPercent, `${clamped}%`);
  elements.playersFill.style.width = `${clamped}%`;

  setText(elements.versionChip, `version: ${data?.version ?? "unknown"}`);
  setText(
    elements.protocolChip,
    `protocol: ${data?.protocol?.name ?? data?.protocol?.version ?? "unknown"}`
  );
  setText(elements.softwareChip, `software: ${data?.software ?? "unknown"}`);

  setText(elements.detailIp, data?.ip ?? "unknown");
  setText(elements.detailHostname, data?.hostname ?? "unknown");
  setText(elements.detailSoftware, data?.software ?? "unknown");

  setText(elements.debugPing, boolText(Boolean(data?.debug?.ping)));
  setText(elements.debugQuery, boolText(Boolean(data?.debug?.query)));
  setText(elements.debugSrv, boolText(Boolean(data?.debug?.srv)));
  setText(elements.debugCachetime, String(data?.debug?.cachetime ?? "unknown"));
  setText(elements.debugAnimatedMotd, boolText(Boolean(data?.debug?.animatedmotd)));

  setText(elements.detailPort, String(data?.port ?? "unknown"));
  setText(elements.detailEulaBlocked, boolText(Boolean(data?.eula_blocked)));
  setText(elements.debugApiVersion, String(data?.debug?.apiversion ?? "unknown"));
  setText(elements.debugCacheHit, boolText(Boolean(data?.debug?.cachehit)));
  setText(elements.debugCacheExpire, String(data?.debug?.cacheexpire ?? "unknown"));
  setText(elements.debugBedrock, boolText(Boolean(data?.debug?.bedrock)));
  setText(elements.debugQueryMismatch, boolText(Boolean(data?.debug?.querymismatch)));
  setText(elements.debugIpInSrv, boolText(Boolean(data?.debug?.ipinsrv)));
  setText(elements.debugCnameInSrv, boolText(Boolean(data?.debug?.cnameinsrv)));
  setText(elements.debugCacheTimeLocal, formatFromUnixSeconds(data?.debug?.cachetime));
  setText(elements.debugQueryError, data?.debug?.error?.query ?? "none");
  setText(
    elements.debugTelemetryLatency,
    typeof latencyMs === "number" ? `${latencyMs} ms` : "unknown"
  );

  renderDnsList(data?.debug?.dns?.a ?? []);
  renderRawTelemetry(data);

  elements.serverIcon.src = ICON_URL;
  elements.serverIcon.alt = `${SERVER_ADDRESS} icon`;

  renderPlayersList(data?.players?.list ?? []);
  pushSparklinePoint(playersOnline);
  addTelemetrySnapshot(data, latencyMs);

  setText(elements.lastUpdated, `Last updated: ${formatTimestamp()}`);
  state.telemetryReady = true;
}

function appendActivityEvent(type, message, when = new Date()) {
  const event = {
    id: `${when.getTime()}-${Math.random().toString(16).slice(2)}`,
    type,
    message,
    timestamp: formatTimestamp(when),
  };

  state.activityEvents.unshift(event);

  if (state.activityEvents.length > 120) {
    state.activityEvents = state.activityEvents.slice(0, 120);
  }
}

function appendActivityEventOnce(type, message, when = new Date(), keyHint = "") {
  const key = `${type}|${message}|${when instanceof Date ? when.toISOString() : String(when)}|${keyHint}`;
  if (state.activitySeenKeys.has(key)) return;

  state.activitySeenKeys.add(key);
  appendActivityEvent(type, message, when instanceof Date ? when : new Date());

  if (state.activitySeenKeys.size > 400) {
    const keys = Array.from(state.activitySeenKeys);
    state.activitySeenKeys = new Set(keys.slice(keys.length - 300));
  }
}

function normalizeEventType(rawType) {
  const type = String(rawType ?? "").toLowerCase();
  if (type.includes("join")) return "join";
  if (type.includes("leave") || type.includes("quit") || type.includes("disconnect")) return "leave";
  if (type.includes("kill") || type.includes("death") || type.includes("died")) return "kill";
  if (type.includes("chat") || type.includes("message") || type.includes("msg")) return "chat";
  return "chat";
}

function parseEventTime(rawTime) {
  if (rawTime == null) {
    return new Date();
  }

  if (typeof rawTime === "number") {
    const ms = rawTime > 9_999_999_999 ? rawTime : rawTime * 1000;
    return new Date(ms);
  }

  const parsed = new Date(rawTime);
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }

  return parsed;
}

function toEventMessage(type, item) {
  const name = item?.player || item?.name || item?.username || "Unknown";
  const target = item?.target || item?.victim || item?.killed || "";
  const attacker = item?.attacker || item?.killer || name;
  const text = item?.message || item?.text || item?.chat || "";

  if (type === "join") {
    return `${name} joined the map.`;
  }
  if (type === "leave") {
    return `${name} left the map.`;
  }
  if (type === "kill") {
    if (target) {
      return `${attacker} killed ${target}.`;
    }
    return `${name} died.`;
  }
  if (text) {
    return `${name}: ${text}`;
  }
  return `${name} sent a message.`;
}

function extractRawEventList(payload) {
  const buckets = [payload?.events, payload?.updates, payload?.activities, payload?.messages];
  const merged = [];

  for (const bucket of buckets) {
    if (Array.isArray(bucket)) {
      merged.push(...bucket);
    }
  }

  return merged;
}

function detectExplicitEvents(payload) {
  const rawEvents = extractRawEventList(payload);
  for (const item of rawEvents) {
    const type = normalizeEventType(item?.type || item?.event || item?.action);
    const time = parseEventTime(item?.timestamp ?? item?.time ?? item?.ts ?? item?.date);
    const message = toEventMessage(type, item);
    const dedupeKey = item?.id || item?.uuid || `${item?.type}|${item?.player}|${item?.message}|${item?.time}`;
    appendActivityEventOnce(type, message, time, dedupeKey);
  }
}

async function fetchJsonWithFallback(primaryUrl, fallbackUrl) {
  try {
    const primary = await fetch(primaryUrl, { cache: "no-store" });
    if (!primary.ok) {
      throw new Error(`Primary request failed: ${primary.status}`);
    }
    return await primary.json();
  } catch (primaryError) {
    if (!fallbackUrl) {
      throw primaryError;
    }

    const fallback = await fetch(fallbackUrl, { cache: "no-store" });
    if (!fallback.ok) {
      throw new Error(`Fallback request failed: ${fallback.status}`);
    }

    return await fallback.json();
  }
}

function renderActivityFeed() {
  elements.activityFeed.innerHTML = "";

  if (state.activityEvents.length === 0) {
    elements.activityFeed.innerHTML = '<li class="activity-item empty-state">No recent activity.</li>';
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const item of state.activityEvents.slice(0, 40)) {
    const li = document.createElement("li");
    li.className = "activity-item";

    const badge = document.createElement("span");
    badge.className = `event-badge event-${item.type}`;
    badge.textContent = item.type;

    const text = document.createElement("span");
    text.className = "event-text";
    text.textContent = item.message;

    const time = document.createElement("time");
    time.className = "event-time";
    time.textContent = item.timestamp;

    li.appendChild(badge);
    li.appendChild(text);
    li.appendChild(time);
    fragment.appendChild(li);
  }

  elements.activityFeed.appendChild(fragment);
}

function buildActivitySnapshot(payload) {
  const players = payload?.players ?? [];
  const snapshot = new Map();

  for (const player of players) {
    const name = player?.name;
    if (!name) continue;

    snapshot.set(name, {
      world: player?.world ?? "unknown",
      x: player?.x ?? null,
      y: player?.y ?? null,
      z: player?.z ?? null,
      health: player?.health ?? null,
      armor: player?.armor ?? null,
    });
  }

  return snapshot;
}

function detectJoinLeaveEvents(nextSnapshot) {
  for (const name of nextSnapshot.keys()) {
    if (!state.activitySnapshot.has(name)) {
      appendActivityEventOnce("join", `${name} joined the map.`);
    }
  }

  for (const name of state.activitySnapshot.keys()) {
    if (!nextSnapshot.has(name)) {
      appendActivityEventOnce("leave", `${name} left the map.`);
    }
  }
}

function detectInferredEvents(nextSnapshot) {
  for (const [name, nextPlayer] of nextSnapshot.entries()) {
    const prevPlayer = state.activitySnapshot.get(name);
    if (!prevPlayer) continue;

    if (prevPlayer.world !== nextPlayer.world) {
      appendActivityEventOnce("chat", `${name} moved from ${prevPlayer.world} to ${nextPlayer.world}.`);
    }

    if (typeof prevPlayer.health === "number" && typeof nextPlayer.health === "number") {
      if (prevPlayer.health > 0 && nextPlayer.health <= 0) {
        appendActivityEventOnce("kill", `${name} died.`);
      }
    }
  }
}

async function fetchTelemetry() {
  try {
    const startedAt = performance.now();
    const response = await fetch(TELEMETRY_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Telemetry request failed: ${response.status}`);
    }

    const data = await response.json();
    const latencyMs = Math.round(performance.now() - startedAt);
    renderTelemetry(data, latencyMs);
  } catch (error) {
    applyOnlineStatus(false);
    if (!state.telemetryReady) {
      setText(elements.motdSubtitle, "Failed to load telemetry.");
      setText(elements.lastUpdated, "Last updated: telemetry unavailable");
      setText(elements.playersCount, "Players: -- / --");
    }
    console.error(error);
  }
}

async function fetchActivity() {
  try {
    const payload = await fetchJsonWithFallback(ACTIVITY_URL, ACTIVITY_URL_FALLBACK);
    const nextSnapshot = buildActivitySnapshot(payload);

    detectExplicitEvents(payload);
    detectJoinLeaveEvents(nextSnapshot);
    detectInferredEvents(nextSnapshot);

    state.activitySnapshot = nextSnapshot;
    state.activityReady = true;
    renderActivityFeed();
  } catch (error) {
    if (!state.activityReady) {
      state.activityEvents = [
        {
          id: "activity-error",
          type: "chat",
          message: "Live activity unavailable.",
          timestamp: formatTimestamp(),
        },
      ];
      renderActivityFeed();
    }
    console.error(error);
  }
}

async function copyIpToClipboard() {
  const text = SERVER_ADDRESS;

  try {
    await navigator.clipboard.writeText(text);
    const original = elements.copyIpButton.textContent;
    elements.copyIpButton.textContent = "Copied";
    setTimeout(() => {
      elements.copyIpButton.textContent = original;
    }, 1200);
  } catch (error) {
    console.error(error);
  }
}

function setupEvents() {
  elements.copyIpButton.addEventListener("click", copyIpToClipboard);
  elements.refreshButton.addEventListener("click", async () => {
    await Promise.all([fetchTelemetry(), fetchActivity()]);
  });
  elements.exportHistoryBtn.addEventListener("click", exportTelemetryHistory);
  elements.clearHistoryBtn.addEventListener("click", clearTelemetryHistory);
}

async function bootstrap() {
  loadTelemetryHistory();
  renderTelemetryHistory();
  createSparkline();
  setupEvents();

  await Promise.all([fetchTelemetry(), fetchActivity()]);

  setInterval(fetchTelemetry, TELEMETRY_POLL_MS);
  setInterval(fetchActivity, ACTIVITY_POLL_MS);
}

bootstrap();
