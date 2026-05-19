const { getStore } = require("@netlify/blobs");

const store = getStore("water-outages");

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

exports.handler = async () => {
  const record = await store.get("current", { type: "json" });
  if (!record) {
    return jsonResponse(404, { error: "No outage notice published yet." });
  }
  return jsonResponse(200, record);
};
