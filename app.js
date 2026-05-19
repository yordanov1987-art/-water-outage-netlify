const statusText = document.getElementById("status-text");
const emptyState = document.getElementById("empty-state");
const noticeCard = document.getElementById("notice-card");
const mapCard = document.getElementById("map-card");

const noticeMunicipality = document.getElementById("notice-municipality");
const noticeTitle = document.getElementById("notice-title");
const noticeDate = document.getElementById("notice-date");
const noticeTime = document.getElementById("notice-time");
const noticeCount = document.getElementById("notice-count");
const noticeText = document.getElementById("notice-text");
const streetsList = document.getElementById("streets-list");
const settlementsList = document.getElementById("settlements-list");
const publishedAt = document.getElementById("published-at");

let map;
let geojsonLayer;

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("bg-BG");
}

function renderTagList(target, items, emptyText) {
  target.innerHTML = "";
  const values = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!values.length) {
    const li = document.createElement("li");
    li.textContent = emptyText;
    target.appendChild(li);
    return;
  }
  values.forEach((value) => {
    const li = document.createElement("li");
    li.textContent = value;
    target.appendChild(li);
  });
}

function ensureMap() {
  if (map) {
    return map;
  }
  map = L.map("map", {
    zoomControl: true,
    attributionControl: true,
  });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  return map;
}

function renderMap(geojson) {
  const features = geojson && Array.isArray(geojson.features) ? geojson.features : [];
  if (!features.length) {
    mapCard.classList.add("hidden");
    return;
  }

  mapCard.classList.remove("hidden");
  const mapInstance = ensureMap();
  if (geojsonLayer) {
    geojsonLayer.remove();
  }

  geojsonLayer = L.geoJSON(geojson, {
    style: {
      color: "#cf4332",
      weight: 5,
      opacity: 0.88,
    },
    onEachFeature(feature, layer) {
      const props = feature && feature.properties ? feature.properties : {};
      const parts = [];
      if (props.address) {
        parts.push(`<b>Улица:</b> ${props.address}`);
      }
      if (props.settlement) {
        parts.push(`<b>Населено място:</b> ${props.settlement}`);
      }
      if (props.src_layer || props.src_fid) {
        parts.push(`<b>Източник:</b> ${props.src_layer || "-"} / FID ${props.src_fid || "-"}`);
      }
      layer.bindPopup(parts.join("<br>"));
    },
  }).addTo(mapInstance);

  const bounds = geojsonLayer.getBounds();
  if (bounds.isValid()) {
    mapInstance.fitBounds(bounds.pad(0.15));
  }
}

function renderNotice(data) {
  const streets = Array.isArray(data.streets) ? data.streets : [];
  const settlements = Array.isArray(data.settlements) ? data.settlements : [];

  emptyState.classList.add("hidden");
  noticeCard.classList.remove("hidden");

  statusText.textContent = "Показано е последното публикувано обявление.";
  noticeMunicipality.textContent = data.municipality || "Без зададена община";
  noticeTitle.textContent = streets.length
    ? `Нарушено водоподаване по ${streets.length} улици`
    : "Нарушено водоподаване";
  noticeDate.textContent = data.notice_date_display || data.notice_date || "-";
  noticeTime.textContent = data.time_from && data.time_to ? `${data.time_from} - ${data.time_to}` : "-";
  noticeCount.textContent = String(data.dry_feature_count || 0);
  noticeText.textContent = data.text || "Няма текст на обявлението.";
  publishedAt.textContent = formatDateTime(data.published_at);

  renderTagList(streetsList, streets, "Няма подадени улици");
  renderTagList(settlementsList, settlements, "Няма подадени населени места");
  renderMap(data.geojson);
}

async function loadCurrentNotice() {
  try {
    const response = await fetch("/.netlify/functions/get-current-outage", {
      headers: { Accept: "application/json" },
    });

    if (response.status === 404) {
      statusText.textContent = "Все още няма публикувано обявление.";
      emptyState.classList.remove("hidden");
      return;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    renderNotice(payload);
  } catch (error) {
    statusText.textContent = "Не успях да заредя обявлението.";
    emptyState.classList.remove("hidden");
    emptyState.innerHTML = `
      <h2>Възникна проблем при зареждане</h2>
      <p>${error.message}</p>
    `;
  }
}

loadCurrentNotice();
