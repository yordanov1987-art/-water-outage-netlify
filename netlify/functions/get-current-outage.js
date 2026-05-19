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
  return getStore("water-outages");
}

exports.handler = async () => {
  try {
    const store = await loadStore();
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
};
