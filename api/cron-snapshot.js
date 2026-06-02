import { kv } from "@vercel/kv";

const HISTORY_KEY = "budpe:telemetry-history";
const HISTORY_LIMIT = 250;
const SERVER_ADDRESS = "play.budpe.com:25565";
const TELEMETRY_URL = `https://api.mcsrvstat.us/3/${SERVER_ADDRESS}`;

function getRequestCronKey(req) {
  const headerKey = req.headers?.["x-cron-key"];
  if (typeof headerKey === "string" && headerKey.length > 0) {
    return headerKey;
  }

  const queryKey = req.query?.key;
  if (typeof queryKey === "string" && queryKey.length > 0) {
    return queryKey;
  }

  return "";
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function loadHistory() {
  try {
    const stored = await kv.get(HISTORY_KEY);
    return Array.isArray(stored) ? stored : [];
  } catch (error) {
    console.error(error);
    return [];
  }
}

function buildIssueScore(data) {
  let score = 0;

  if (!data?.online) score += 1;
  if (!data?.debug?.ping) score += 1;
  if (!data?.debug?.query) score += 1;
  if (!data?.debug?.srv) score += 1;
  if (data?.eula_blocked) score += 1;
  if (data?.debug?.error?.query) score += 1;

  return score;
}

function toSnapshot(data, latencyMs) {
  const playersOnline = toNumber(data?.players?.online, 0);
  const playersMax = toNumber(data?.players?.max, 0);

  return {
    timestampIso: new Date().toISOString(),
    timestamp: new Date().toLocaleString(),
    online: Boolean(data?.online),
    playersOnline,
    playersMax,
    players: `${playersOnline} / ${playersMax}`,
    version: data?.version ?? "unknown",
    protocol: String(data?.protocol?.name ?? data?.protocol?.version ?? "unknown"),
    cacheHit: String(Boolean(data?.debug?.cachehit)),
    issueScore: buildIssueScore(data),
    issueSummary: "cron",
    fetchLatencyMs: latencyMs,
  };
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const requiredKey = process.env.CRON_SECRET;
  if (requiredKey && getRequestCronKey(req) !== requiredKey) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  try {
    const startedAt = Date.now();
    const response = await fetch(TELEMETRY_URL, { cache: "no-store" });
    if (!response.ok) {
      sendJson(res, response.status, { error: `Telemetry source failed: ${response.status}` });
      return;
    }

    const data = await response.json();
    const snapshot = toSnapshot(data, Date.now() - startedAt);
    const history = [snapshot, ...(await loadHistory())].slice(0, HISTORY_LIMIT);

    try {
      await kv.set(HISTORY_KEY, history);
    } catch (error) {
      console.error(error);
    }

    sendJson(res, 200, { ok: true, count: history.length });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Unable to create snapshot" });
  }
}