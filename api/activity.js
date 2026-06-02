const ACTIVITY_SOURCE_URL = "https://map.budpe.com/maps/bu_world/live/players.json";

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

  try {
    const response = await fetch(ACTIVITY_SOURCE_URL, {
      cache: "no-store",
      headers: {
        "User-Agent": "minecraft-dev-page/1.0",
      },
    });

    if (!response.ok) {
      sendJson(res, response.status, { error: `Activity source failed: ${response.status}` });
      return;
    }

    const payload = await response.json();
    sendJson(res, 200, payload);
  } catch (error) {
    console.error(error);
    sendJson(res, 502, { error: "Activity upstream unavailable" });
  }
}