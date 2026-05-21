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

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const text = String(value || "").trim();
    if (!text) {
      continue;
    }
    const key = text.toLocaleLowerCase("bg-BG");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(text);
  }
  return result;
}

function normalizeSettlementGroups(groups) {
  const merged = new Map();
  for (const group of Array.isArray(groups) ? groups : []) {
    const settlement = String((group && group.settlement) || "").trim();
    if (!settlement) {
      continue;
    }
    const key = settlement.toLocaleLowerCase("bg-BG");
    if (!merged.has(key)) {
      merged.set(key, {
        settlement,
        streets: [],
      });
    }
    const target = merged.get(key);
    target.streets = uniqueStrings([...(target.streets || []), ...((group && group.streets) || [])]);
  }
  return Array.from(merged.values());
}

function normalizeNotice(rawNotice, noticeDate = "", fallbackPublishedAt = "", index = 0) {
  const notice = rawNotice && typeof rawNotice === "object" ? rawNotice : {};
  const resolvedDate = String(notice.notice_date || noticeDate || "").trim();
  const publishedAt = String(notice.published_at || fallbackPublishedAt || "").trim();
  const updatedAt = String(notice.updated_at || publishedAt || fallbackPublishedAt || "").trim();
  const noticeId = String(notice.notice_id || `legacy-${resolvedDate || "undated"}-${index + 1}`).trim();

  return {
    ...notice,
    notice_id: noticeId,
    notice_date: resolvedDate,
    notice_date_display: String(notice.notice_date_display || "").trim(),
    municipality: String(notice.municipality || "").trim(),
    settlements: uniqueStrings(notice.settlements),
    streets: uniqueStrings(notice.streets),
    settlement_groups: normalizeSettlementGroups(notice.settlement_groups),
    text: String(notice.text || "").trim(),
    published_at: publishedAt,
    updated_at: updatedAt,
    time_from: String(notice.time_from || "").trim(),
    time_to: String(notice.time_to || "").trim(),
    dry_feature_count: Number(notice.dry_feature_count || 0),
    dry_segments: Array.isArray(notice.dry_segments) ? notice.dry_segments : [],
    geojson:
      notice.geojson && typeof notice.geojson === "object"
        ? notice.geojson
        : { type: "FeatureCollection", features: [] },
    incident_display: String(notice.incident_display || "").trim(),
    incident_point: notice.incident_point && typeof notice.incident_point === "object" ? notice.incident_point : null,
  };
}

function sortNotices(notices) {
  return [...(Array.isArray(notices) ? notices : [])].sort((a, b) => {
    const timeA = String((a && a.time_from) || "");
    const timeB = String((b && b.time_from) || "");
    if (timeA !== timeB) {
      return timeA.localeCompare(timeB);
    }

    const publishedA = String((a && (a.published_at || a.updated_at)) || "");
    const publishedB = String((b && (b.published_at || b.updated_at)) || "");
    if (publishedA !== publishedB) {
      return publishedA.localeCompare(publishedB);
    }

    return String((a && a.notice_id) || "").localeCompare(String((b && b.notice_id) || ""));
  });
}

function normalizeBucket(rawRecord, noticeDate = "") {
  if (!rawRecord) {
    return {
      notice_date: String(noticeDate || "").trim(),
      notice_date_display: "",
      municipality: "",
      notices: [],
      total_notice_count: 0,
      updated_at: "",
    };
  }

  const noticesSource = Array.isArray(rawRecord)
    ? rawRecord
    : Array.isArray(rawRecord.notices)
      ? rawRecord.notices
      : [rawRecord];

  const normalizedNotices = sortNotices(
    noticesSource.map((notice, index) => normalizeNotice(notice, noticeDate || rawRecord.notice_date, rawRecord.updated_at, index)),
  );
  const first = normalizedNotices[0] || {};

  return {
    notice_date: String(rawRecord.notice_date || noticeDate || first.notice_date || "").trim(),
    notice_date_display: String(rawRecord.notice_date_display || first.notice_date_display || "").trim(),
    municipality: String(rawRecord.municipality || first.municipality || "").trim(),
    notices: normalizedNotices,
    total_notice_count: normalizedNotices.length,
    updated_at: String(rawRecord.updated_at || first.updated_at || first.published_at || "").trim(),
  };
}

function buildCalendarEntry(bucket) {
  const notices = Array.isArray(bucket.notices) ? bucket.notices : [];
  const settlements = uniqueStrings(notices.flatMap((notice) => notice.settlements || []));
  const streets = uniqueStrings(notices.flatMap((notice) => notice.streets || []));
  const groups = normalizeSettlementGroups(notices.flatMap((notice) => notice.settlement_groups || []));
  const first = notices[0] || {};
  const noticeCount = notices.length;
  const updatedAt = String(
    bucket.updated_at
      || notices.reduce((latest, notice) => {
        const value = String(notice.updated_at || notice.published_at || "");
        return value > latest ? value : latest;
      }, ""),
  ).trim();

  return {
    date: String(bucket.notice_date || "").trim(),
    notice_date_display: String(bucket.notice_date_display || first.notice_date_display || "").trim(),
    municipality: String(bucket.municipality || first.municipality || "").trim(),
    time_from: noticeCount === 1 ? String(first.time_from || "").trim() : "",
    time_to: noticeCount === 1 ? String(first.time_to || "").trim() : "",
    settlements,
    streets,
    settlement_groups: groups,
    dry_feature_count: notices.reduce((sum, notice) => sum + Number(notice.dry_feature_count || 0), 0),
    updated_at: updatedAt,
    notice_count: noticeCount,
  };
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

  const noticeId = String((payload && payload.notice_id) || "").trim();

  try {
    const store = getStore("water-outages");
    const datedKey = `notices/${noticeDate}.json`;
    const existing = await store.get(datedKey, { type: "json" });
    const calendar = (await store.get("calendar", { type: "json" })) || { dates: [] };
    const currentDates = Array.isArray(calendar.dates) ? calendar.dates : [];
    const updatedAt = new Date().toISOString();
    const publicUrl = siteBaseUrl() || null;

    if (!existing) {
      const remainingEntries = currentDates
        .filter((entry) => String((entry && entry.date) || "").trim() !== noticeDate)
        .sort((a, b) => String((a && a.date) || "").localeCompare(String((b && b.date) || "")));
      await store.setJSON("calendar", {
        dates: remainingEntries,
        updated_at: updatedAt,
      });
      return jsonResponse(200, {
        ok: true,
        deleted: false,
        missing: true,
        remaining_dates: remainingEntries.map((entry) => entry.date),
        public_url: publicUrl,
      });
    }

    const bucket = normalizeBucket(existing, noticeDate);
    let nextBucket = bucket;
    let deletedNotice = null;
    let deletedWholeDate = false;

    if (noticeId) {
      const remainingNotices = bucket.notices.filter((notice) => String(notice.notice_id || "") !== noticeId);
      if (remainingNotices.length === bucket.notices.length) {
        return jsonResponse(200, {
          ok: true,
          deleted: false,
          missing: true,
          missing_notice_id: noticeId,
          remaining_notice_count: bucket.notices.length,
          remaining_dates: currentDates.map((entry) => entry.date),
          public_url: publicUrl,
        });
      }

      deletedNotice = bucket.notices.find((notice) => String(notice.notice_id || "") === noticeId) || null;
      if (remainingNotices.length) {
        nextBucket = {
          notice_date: noticeDate,
          notice_date_display: bucket.notice_date_display,
          municipality: bucket.municipality,
          notices: sortNotices(remainingNotices),
          total_notice_count: remainingNotices.length,
          updated_at: updatedAt,
        };
        await store.setJSON(datedKey, nextBucket);
      } else {
        deletedWholeDate = true;
        await removeStoreKey(store, datedKey);
      }
    } else {
      deletedWholeDate = true;
      deletedNotice = bucket.notices[0] || null;
      await removeStoreKey(store, datedKey);
    }

    let remainingEntries;
    if (deletedWholeDate) {
      remainingEntries = currentDates
        .filter((entry) => String((entry && entry.date) || "").trim() !== noticeDate)
        .sort((a, b) => String((a && a.date) || "").localeCompare(String((b && b.date) || "")));
    } else {
      const nextEntry = buildCalendarEntry(nextBucket);
      remainingEntries = [
        ...currentDates.filter((entry) => String((entry && entry.date) || "").trim() !== noticeDate),
        nextEntry,
      ].sort((a, b) => String((a && a.date) || "").localeCompare(String((b && b.date) || "")));
    }

    const nextDate = chooseDefaultDate(remainingEntries);
    if (nextDate) {
      const nextRecord = deletedWholeDate && nextDate === noticeDate
        ? nextBucket
        : await store.get(`notices/${nextDate}.json`, { type: "json" });
      if (nextRecord) {
        await store.setJSON("current", nextDate === noticeDate && !deletedWholeDate ? nextBucket : nextRecord);
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
      action: "delete",
      deleted_at: updatedAt,
      deleted_notice_date: noticeDate,
      deleted_notice_id: noticeId || null,
      deleted_record: deletedWholeDate ? bucket : deletedNotice,
      remaining_notice_count: deletedWholeDate ? 0 : nextBucket.notices.length,
    });

    return jsonResponse(200, {
      ok: true,
      deleted: true,
      deleted_notice_date: noticeDate,
      deleted_notice_id: noticeId || null,
      deleted_whole_date: deletedWholeDate,
      remaining_notice_count: deletedWholeDate ? 0 : nextBucket.notices.length,
      remaining_dates: remainingEntries.map((entry) => entry.date),
      public_url: publicUrl,
    });
  } catch (error) {
    return jsonResponse(500, {
      error: error && error.message ? error.message : String(error),
      runtime: process.version,
      function: "delete-outage",
    });
  }
}
