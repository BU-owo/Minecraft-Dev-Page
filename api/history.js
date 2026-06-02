import { kv } from "@vercel/kv";

const HISTORY_KEY = "budpe:telemetry-history";
const DISPLAY_MAX_PLAYERS = 20;
const SERVER_ADDRESS = "play.budpe.com:25565";
const TELEMETRY_URL = `https://api.mcsrvstat.us/3/${SERVER_ADDRESS}`;

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

function kvConfigured() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
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

function snapshotFromTelemetry(data, latencyMs) {
  const playersOnlineRaw = toNumber(data?.players?.online, 0);
  const playersMaxRaw = toNumber(data?.players?.max, 0);
  const playersMax = Math.min(
    playersMaxRaw > 0 ? playersMaxRaw : DISPLAY_MAX_PLAYERS,
    DISPLAY_MAX_PLAYERS
  );
  const playersOnline = Math.min(playersOnlineRaw, playersMax);

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
    issueSummary: "seed",
    fetchLatencyMs: typeof latencyMs === "number" ? latencyMs : "unknown",
  };
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

  return history.map(normalizeSnapshot).filter(Boolean);
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
  const stored = await kv.get(HISTORY_KEY);
  return normalizeHistory(Array.isArray(stored) ? stored : []);
}

async function writeHistory(history) {
  const normalized = normalizeHistory(history);
  await kv.set(HISTORY_KEY, normalized);
  return normalized;
}

async function buildSeedSnapshot() {
  const startedAt = Date.now();
  const response = await fetch(TELEMETRY_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Telemetry source failed: ${response.status}`);
  }

  const data = await response.json();
  return normalizeSnapshot(snapshotFromTelemetry(data, Date.now() - startedAt));
}

export default async function handler(req, res) {
  if (!kvConfigured()) {
    sendJson(res, 503, {
      error: "Shared history backend is not configured",
      details: "Missing KV_REST_API_URL or KV_REST_API_TOKEN",
    });
    return;
  }

  if (req.method === "GET") {
    try {
      let history = await readHistory();

      // Ensure the shared timeline starts immediately for first-time deployments.
      if (history.length === 0) {
        const seed = await buildSeedSnapshot();
        if (seed) {
          history = await writeHistory([seed]);
        }
      }

      sendJson(res, 200, { history });
      return;
    } catch (error) {
      console.error(error);
      sendJson(res, 500, { error: "Unable to read shared history" });
      return;
    }
  }

  if (req.method === "POST") {
    try {
      const body = await readBody(req);
      const snapshot = normalizeSnapshot(body?.snapshot ?? body);

      if (!snapshot) {
        sendJson(res, 400, { error: "Invalid snapshot" });
        return;
      }

      const history = await writeHistory([snapshot, ...(await readHistory())]);
      sendJson(res, 200, { history });
      return;
    } catch (error) {
      console.error(error);
      sendJson(res, 500, { error: "Unable to save shared history" });
      return;
    }
  }

  if (req.method === "DELETE") {
    try {
      await kv.del(HISTORY_KEY);
      sendJson(res, 200, { history: [] });
      return;
    } catch (error) {
      console.error(error);
      sendJson(res, 500, { error: "Unable to clear shared history" });
      return;
    }
  }

  res.setHeader("Allow", "GET,POST,DELETE");
  sendJson(res, 405, { error: "Method not allowed" });
}