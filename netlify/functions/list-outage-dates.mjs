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

export default async function handler() {
  try {
    const store = getStore("water-outages");
    const calendar = (await store.get("calendar", { type: "json" })) || { dates: [] };
    return jsonResponse(200, {
      dates: Array.isArray(calendar.dates) ? calendar.dates : [],
      updated_at: calendar.updated_at || null,
    });
  } catch (error) {
    return jsonResponse(500, {
      error: error && error.message ? error.message : String(error),
      runtime: process.version,
      function: "list-outage-dates",
    });
  }
}
