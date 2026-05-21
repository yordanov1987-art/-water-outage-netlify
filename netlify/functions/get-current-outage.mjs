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

    return jsonResponse(200, {
      ...record,
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
