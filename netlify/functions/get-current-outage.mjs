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
    const record = await store.get("current", { type: "json" });
    if (!record) {
      return jsonResponse(404, { error: "No outage notice published yet." });
    }
    return jsonResponse(200, record);
  } catch (error) {
    return jsonResponse(500, {
      error: error && error.message ? error.message : String(error),
      runtime: process.version,
      function: "get-current-outage",
    });
  }
}
