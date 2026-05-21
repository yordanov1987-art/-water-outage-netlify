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

function aggregateSettlementGroups(notices) {
  const merged = new Map();
  for (const notice of Array.isArray(notices) ? notices : []) {
    for (const group of Array.isArray(notice.settlement_groups) ? notice.settlement_groups : []) {
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
  }
  return Array.from(merged.values());
}

function buildCalendarEntry(bucket) {
  const notices = Array.isArray(bucket.notices) ? bucket.notices : [];
  const settlements = uniqueStrings(notices.flatMap((notice) => notice.settlements || []));
  const streets = uniqueStrings(notices.flatMap((notice) => notice.streets || []));
  const groups = aggregateSettlementGroups(notices);
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
    const incomingNotice = normalizeNotice(
      {
        ...payload,
        published_at: payload.published_at || publishedAt,
        updated_at: publishedAt,
      },
      noticeDate,
      publishedAt,
    );
    const datedKey = `notices/${noticeDate}.json`;
    const existing = await store.get(datedKey, { type: "json" });
    const existingBucket = normalizeBucket(existing, noticeDate);
    const nextNotices = [...existingBucket.notices];
    const existingIndex = nextNotices.findIndex((notice) => String(notice.notice_id || "") === incomingNotice.notice_id);
    if (existingIndex >= 0) {
      nextNotices[existingIndex] = incomingNotice;
    } else {
      nextNotices.push(incomingNotice);
    }

    const nextBucket = {
      notice_date: noticeDate,
      notice_date_display: incomingNotice.notice_date_display,
      municipality: incomingNotice.municipality,
      notices: sortNotices(nextNotices),
      total_notice_count: nextNotices.length,
      updated_at: publishedAt,
    };

    const archiveKey = `history/publish-${publishedAt.replace(/[:.]/g, "-")}.json`;
    const calendar = (await store.get("calendar", { type: "json" })) || { dates: [] };
    const currentDates = Array.isArray(calendar.dates) ? calendar.dates : [];
    const nextEntry = buildCalendarEntry(nextBucket);
    const mergedDates = [
      ...currentDates.filter((entry) => String((entry && entry.date) || "").trim() !== noticeDate),
      nextEntry,
    ].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

    await store.setJSON(datedKey, nextBucket);
    await store.setJSON("current", nextBucket);
    await store.setJSON("calendar", {
      dates: mergedDates,
      updated_at: publishedAt,
    });
    await store.setJSON(archiveKey, {
      action: "publish",
      notice_date: noticeDate,
      notice_id: incomingNotice.notice_id,
      notice: incomingNotice,
      bucket: nextBucket,
    });

    return jsonResponse(200, {
      ok: true,
      archive_key: archiveKey,
      stored_key: datedKey,
      public_url: siteBaseUrl() || null,
      notice_id: incomingNotice.notice_id,
      notice_count: nextBucket.total_notice_count,
    });
  } catch (error) {
    return jsonResponse(500, {
      error: error && error.message ? error.message : String(error),
      runtime: process.version,
      function: "publish-outage",
    });
  }
}
