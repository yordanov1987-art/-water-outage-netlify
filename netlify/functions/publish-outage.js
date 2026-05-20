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

async function loadStore() {
  const mod = await import("@netlify/blobs");
  const getStore =
    (mod && typeof mod.getStore === "function" && mod.getStore)
    || (mod && mod.default && typeof mod.default.getStore === "function" && mod.default.getStore);
  if (typeof getStore !== "function") {
    throw new Error("Netlify Blobs getStore() is not available in this runtime.");
  }
  const siteID = process.env.SITE_ID || process.env.NETLIFY_BLOBS_SITE_ID || "";
  const token = process.env.NETLIFY_BLOBS_TOKEN || "";
  if (!siteID) {
    throw new Error("Missing SITE_ID for Netlify Blobs.");
  }
  if (!token) {
    throw new Error("Missing NETLIFY_BLOBS_TOKEN environment variable.");
  }
  return getStore("water-outages", { siteID, token });
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

  try {
    const store = await loadStore();
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
};
