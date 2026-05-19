const { getStore } = require("@netlify/blobs");

const store = getStore({ name: "water-outages" });

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: JSON.stringify(payload),
  };
}

function siteBaseUrl() {
  return (process.env.URL || process.env.DEPLOY_URL || "").replace(/\/$/, "");
}

function requireSecret(event) {
  const expected = (process.env.NETLIFY_OUTAGE_SECRET || "").trim();
  if (!expected) {
    return null;
  }
  const provided = String(event.headers["x-outage-secret"] || event.headers["X-Outage-Secret"] || "").trim();
  if (provided === expected) {
    return null;
  }
  return jsonResponse(401, { error: "Invalid publish secret." });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  const denied = requireSecret(event);
  if (denied) {
    return denied;
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (error) {
    return jsonResponse(400, { error: "Invalid JSON payload." });
  }

  if (!payload || typeof payload !== "object") {
    return jsonResponse(400, { error: "Missing payload." });
  }

  if (!String(payload.text || "").trim()) {
    return jsonResponse(400, { error: "Announcement text is required." });
  }

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
};
