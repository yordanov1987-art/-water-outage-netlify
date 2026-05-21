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

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function buildCalendarEntry(record) {
  const groups = Array.isArray(record.settlement_groups) ? record.settlement_groups : [];
  return {
    date: String(record.notice_date || "").trim(),
    notice_date_display: String(record.notice_date_display || "").trim(),
    municipality: String(record.municipality || "").trim(),
    time_from: String(record.time_from || "").trim(),
    time_to: String(record.time_to || "").trim(),
    settlements: Array.isArray(record.settlements) ? record.settlements : [],
    streets: Array.isArray(record.streets) ? record.streets : [],
    settlement_groups: groups,
    dry_feature_count: Number(record.dry_feature_count || 0),
    updated_at: String(record.updated_at || record.published_at || "").trim(),
  };
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

  const noticeDate = String(payload.notice_date || "").trim();
  if (!isIsoDate(noticeDate)) {
    return jsonResponse(400, { error: "notice_date is required in YYYY-MM-DD format." });
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
    const datedKey = `notices/${noticeDate}.json`;
    const calendar = (await store.get("calendar", { type: "json" })) || { dates: [] };
    const currentDates = Array.isArray(calendar.dates) ? calendar.dates : [];
    const nextEntry = buildCalendarEntry(record);
    const mergedDates = [
      ...currentDates.filter((entry) => String((entry && entry.date) || "").trim() !== noticeDate),
      nextEntry,
    ].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

    await store.setJSON(datedKey, record);
    await store.setJSON("current", record);
    await store.setJSON("calendar", {
      dates: mergedDates,
      updated_at: publishedAt,
    });
    await store.setJSON(archiveKey, record);

    return jsonResponse(200, {
      ok: true,
      archive_key: archiveKey,
      stored_key: datedKey,
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
