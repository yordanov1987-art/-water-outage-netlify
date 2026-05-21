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

function chooseDefaultDate(entries) {
  const dates = (Array.isArray(entries) ? entries : [])
    .map((entry) => String((entry && entry.date) || "").trim())
    .filter(Boolean)
    .sort();

  if (!dates.length) {
    return "";
  }

  const today = new Date().toISOString().slice(0, 10);
  if (dates.includes(today)) {
    return today;
  }

  const upcoming = dates.find((date) => date >= today);
  if (upcoming) {
    return upcoming;
  }

  return dates[dates.length - 1];
}

async function removeStoreKey(store, key) {
  if (typeof store.delete === "function") {
    await store.delete(key);
    return;
  }

  await store.setJSON(key, null);
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

  const noticeDate = String((payload && payload.notice_date) || "").trim();
  if (!isIsoDate(noticeDate)) {
    return jsonResponse(400, { error: "notice_date is required in YYYY-MM-DD format." });
  }

  try {
    const store = getStore("water-outages");
    const datedKey = `notices/${noticeDate}.json`;
    const existing = await store.get(datedKey, { type: "json" });
    const calendar = (await store.get("calendar", { type: "json" })) || { dates: [] };
    const currentDates = Array.isArray(calendar.dates) ? calendar.dates : [];
    const remainingEntries = currentDates
      .filter((entry) => String((entry && entry.date) || "").trim() !== noticeDate)
      .sort((a, b) => String((a && a.date) || "").localeCompare(String((b && b.date) || "")));
    const updatedAt = new Date().toISOString();

    if (!existing) {
      await store.setJSON("calendar", {
        dates: remainingEntries,
        updated_at: updatedAt,
      });
      return jsonResponse(200, {
        ok: true,
        deleted: false,
        missing: true,
        remaining_dates: remainingEntries.map((entry) => entry.date),
        public_url: siteBaseUrl() || null,
      });
    }

    await removeStoreKey(store, datedKey);

    const nextDate = chooseDefaultDate(remainingEntries);
    if (nextDate) {
      const nextRecord = await store.get(`notices/${nextDate}.json`, { type: "json" });
      if (nextRecord) {
        await store.setJSON("current", nextRecord);
      } else {
        await removeStoreKey(store, "current");
      }
    } else {
      await removeStoreKey(store, "current");
    }

    await store.setJSON("calendar", {
      dates: remainingEntries,
      updated_at: updatedAt,
    });
    await store.setJSON(`history/delete-${updatedAt.replace(/[:.]/g, "-")}.json`, {
      deleted_at: updatedAt,
      deleted_notice_date: noticeDate,
      deleted_record: existing,
    });

    return jsonResponse(200, {
      ok: true,
      deleted: true,
      deleted_notice_date: noticeDate,
      remaining_dates: remainingEntries.map((entry) => entry.date),
      public_url: siteBaseUrl() || null,
    });
  } catch (error) {
    return jsonResponse(500, {
      error: error && error.message ? error.message : String(error),
      runtime: process.version,
      function: "delete-outage",
    });
  }
}
