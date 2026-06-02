import { kv } from "@vercel/kv";

const HISTORY_KEY = "budpe:telemetry-history";
const HISTORY_LIMIT = 250;

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

function parsePlayersMax(players) {
  if (typeof players === "string") {
    const match = players.match(/^\d+\s*\/\s*(\d+)$/);
    if (match) {
      return toNumber(match[1], 0);
    }
  }

  return toNumber(players?.max ?? 0, 0);
}

function normalizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }

  const playersOnline = toNumber(snapshot.playersOnline ?? (typeof snapshot.players === "string" ? snapshot.players.split("/")[0] : 0), 0);

  return {
    timestampIso: typeof snapshot.timestampIso === "string" ? snapshot.timestampIso : new Date().toISOString(),
    timestamp: typeof snapshot.timestamp === "string" ? snapshot.timestamp : new Date().toLocaleString(),
    online: parseBooleanValue(snapshot.online),
    playersOnline,
    playersMax: toNumber(snapshot.playersMax ?? parsePlayersMax(snapshot.players), 0),
    players: typeof snapshot.players === "string" ? snapshot.players : `${playersOnline} / ${toNumber(snapshot.playersMax ?? 0, 0)}`,
    version: typeof snapshot.version === "string" ? snapshot.version : "unknown",
    protocol: typeof snapshot.protocol === "string" ? snapshot.protocol : String(snapshot.protocol ?? "unknown"),
    cacheHit: typeof snapshot.cacheHit === "string" ? snapshot.cacheHit : String(Boolean(snapshot.cacheHit)),
    issueScore: toNumber(snapshot.issueScore, parseBooleanValue(snapshot.online) ? 0 : 1),
    issueSummary: typeof snapshot.issueSummary === "string" ? snapshot.issueSummary : "none",
    fetchLatencyMs:
      snapshot.fetchLatencyMs === "unknown" || snapshot.fetchLatencyMs == null
        ? "unknown"
        : toNumber(snapshot.fetchLatencyMs, 0),
  };
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history.map(normalizeSnapshot).filter(Boolean).slice(0, HISTORY_LIMIT);
}

async function readBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) {
    return {};
  }

  return JSON.parse(text);
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function readHistory() {
  try {
    const stored = await kv.get(HISTORY_KEY);
    return normalizeHistory(Array.isArray(stored) ? stored : []);
  } catch (error) {
    console.error(error);
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const history = await readHistory();
    sendJson(res, 200, { history });
    return;
  }

  if (req.method === "POST") {
    try {
      const body = await readBody(req);
      const snapshot = normalizeSnapshot(body?.snapshot ?? body);

      if (!snapshot) {
        sendJson(res, 400, { error: "Invalid snapshot" });
        return;
      }

      const history = [snapshot, ...(await readHistory())].slice(0, HISTORY_LIMIT);
      try {
        await kv.set(HISTORY_KEY, history);
      } catch (error) {
        console.error(error);
      }
      sendJson(res, 200, { history });
      return;
    } catch (error) {
      console.error(error);
      sendJson(res, 500, { error: "Unable to save history" });
      return;
    }
  }

  if (req.method === "DELETE") {
    try {
      try {
        await kv.del(HISTORY_KEY);
      } catch (error) {
        console.error(error);
      }
      sendJson(res, 200, { history: [] });
      return;
    } catch (error) {
      console.error(error);
      sendJson(res, 500, { error: "Unable to clear history" });
      return;
    }
  }

  res.setHeader("Allow", "GET,POST,DELETE");
  sendJson(res, 405, { error: "Method not allowed" });
}