import { getStore } from "@netlify/blobs";

function jsonResponse(statusCode, payload) {
  return new Response(JSON.stringify(payload), {
    status: statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function siteBaseUrl() {
  return (process.env.URL || process.env.DEPLOY_URL || "").replace(/\/$/, "");
}

function invalidSecretResponse() {
  return jsonResponse(401, { error: "Invalid publish secret." });
}

export default async function handler(req) {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  const expected = (process.env.NETLIFY_OUTAGE_SECRET || "").trim();
  const provided = String(req.headers.get("x-outage-secret") || "").trim();
  if (expected && provided !== expected) {
    return invalidSecretResponse();
  }

  let payload;
  try {
    payload = await req.json();
  } catch (error) {
    return jsonResponse(400, { error: "Invalid JSON payload." });
  }

  if (!payload || typeof payload !== "object") {
    return jsonResponse(400, { error: "Missing payload." });
  }

  if (!String(payload.text || "").trim()) {
    return jsonResponse(400, { error: "Announcement text is required." });
  }

  try {
    const store = getStore("water-outages");
    const publishedAt = new Date().toISOString();
    const record = {
      ...payload,
      published_at: payload.published_at || publishedAt,
      updated_at: publishedAt,
    };

    const archiveKey = `history/${publishedAt.replace(/[:.]/g, "-")}.json`;
    await store.setJSON("current", record);
    await store.setJSON(archiveKey, record);

    return jsonResponse(200, {
      ok: true,
      archive_key: archiveKey,
      public_url: siteBaseUrl() || null,
    });
  } catch (error) {
    return jsonResponse(500, {
      error: error && error.message ? error.message : String(error),
      runtime: process.version,
      function: "publish-outage",
    });
  }
}
