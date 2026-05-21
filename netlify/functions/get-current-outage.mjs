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

export default async function handler(req) {
  try {
    const store = getStore("water-outages");
    const url = new URL(req.url);
    const calendar = (await store.get("calendar", { type: "json" })) || { dates: [] };
    const requestedDate = String(url.searchParams.get("date") || "").trim();

    let targetDate = "";
    if (requestedDate) {
      if (!isIsoDate(requestedDate)) {
        return jsonResponse(400, { error: "Invalid date format. Expected YYYY-MM-DD." });
      }
      targetDate = requestedDate;
    } else {
      targetDate = chooseDefaultDate(calendar.dates);
    }

    if (!targetDate) {
      return jsonResponse(404, { error: "No outage notice published yet." });
    }

    const record = await store.get(`notices/${targetDate}.json`, { type: "json" });
    if (!record) {
      return jsonResponse(404, { error: "No outage notice published for the selected date." });
    }

    const bucket = normalizeBucket(record, targetDate);
    const first = bucket.notices[0] || {};

    return jsonResponse(200, {
      ...first,
      ...bucket,
      selected_date: targetDate,
      available_dates: Array.isArray(calendar.dates) ? calendar.dates : [],
    });
  } catch (error) {
    return jsonResponse(500, {
      error: error && error.message ? error.message : String(error),
      runtime: process.version,
      function: "get-current-outage",
    });
  }
}
