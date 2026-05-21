const statusText = document.getElementById("status-text");
const emptyState = document.getElementById("empty-state");
const noticeCard = document.getElementById("notice-card");
const mapCard = document.getElementById("map-card");
const calendarGrid = document.getElementById("calendar-grid");
const calendarMonthLabel = document.getElementById("calendar-month-label");
const prevMonthBtn = document.getElementById("prev-month");
const nextMonthBtn = document.getElementById("next-month");

const noticeMunicipality = document.getElementById("notice-municipality");
const noticeTitle = document.getElementById("notice-title");
const noticeDate = document.getElementById("notice-date");
const noticeTime = document.getElementById("notice-time");
const noticeCount = document.getElementById("notice-count");
const noticeText = document.getElementById("notice-text");
const groupedSettlements = document.getElementById("grouped-settlements");
const publishedAt = document.getElementById("published-at");

let map;
let geojsonLayer;
let incidentMarker;
let availableEntries = [];
let availableDateMap = new Map();
let selectedDate = "";
let visibleMonth = null;

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

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

function formatDateDisplay(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("bg-BG");
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

function groupedDataFromPayload(data) {
  if (Array.isArray(data.settlement_groups) && data.settlement_groups.length) {
    return data.settlement_groups;
  }

  const settlements = Array.isArray(data.settlements) ? data.settlements.filter(Boolean) : [];
  const streets = Array.isArray(data.streets) ? data.streets.filter(Boolean) : [];
  if (!settlements.length && !streets.length) {
    return [];
  }

  const firstSettlement = settlements[0] || "Неуточнено населено място";
  return [{ settlement: firstSettlement, streets }];
}

function renderGroupedSettlements(groups) {
  groupedSettlements.innerHTML = "";
  const values = Array.isArray(groups) ? groups : [];

  if (!values.length) {
    const block = document.createElement("div");
    block.className = "settlement-block";
    block.innerHTML = "<h4>Няма подадени улици</h4><p class=\"subtle\">Няма публикувана допълнителна информация за засегнати улици.</p>";
    groupedSettlements.appendChild(block);
    return;
  }

  values.forEach((group) => {
    const block = document.createElement("section");
    block.className = "settlement-block";

    const title = document.createElement("h4");
    title.textContent = group.settlement || "Неуточнено населено място";
    block.appendChild(title);

    const streets = Array.isArray(group.streets) ? group.streets.filter(Boolean) : [];
    if (!streets.length) {
      const empty = document.createElement("p");
      empty.className = "subtle";
      empty.textContent = "Няма изброени улици.";
      block.appendChild(empty);
    } else {
      const list = document.createElement("ul");
      streets.forEach((street) => {
        const item = document.createElement("li");
        item.textContent = street;
        list.appendChild(item);
      });
      block.appendChild(list);
    }

    groupedSettlements.appendChild(block);
  });
}

function incidentLatLng(point) {
  if (!point || point.type !== "Point" || !Array.isArray(point.coordinates) || point.coordinates.length < 2) {
    return null;
  }
  return [Number(point.coordinates[1]), Number(point.coordinates[0])];
}

function renderMap(data) {
  const features = data && data.geojson && Array.isArray(data.geojson.features) ? data.geojson.features : [];
  const point = incidentLatLng(data && data.incident_point);

  if (!features.length && !point) {
    mapCard.classList.add("hidden");
    return;
  }

  mapCard.classList.remove("hidden");
  const mapInstance = ensureMap();
  if (geojsonLayer) {
    geojsonLayer.remove();
  }
  if (incidentMarker) {
    incidentMarker.remove();
  }

  geojsonLayer = null;
  if (features.length) {
    geojsonLayer = L.geoJSON(data.geojson, {
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
  }

  if (point) {
    incidentMarker = L.marker(point, {
      icon: L.divIcon({
        className: "",
        html: '<div class="repair-marker" title="Авария / ремонт">🚧</div>',
        iconSize: [42, 42],
        iconAnchor: [21, 21],
      }),
    }).addTo(mapInstance);
    incidentMarker.bindPopup(data.incident_display || "Място на аварията / ремонта");
  }

  const bounds = [];
  if (geojsonLayer) {
    const geojsonBounds = geojsonLayer.getBounds();
    if (geojsonBounds.isValid()) {
      bounds.push(geojsonBounds);
    }
  }
  if (incidentMarker) {
    bounds.push(L.latLngBounds([point, point]));
  }

  if (bounds.length === 1) {
    mapInstance.fitBounds(bounds[0].pad(0.15));
  } else if (bounds.length > 1) {
    const merged = bounds[0].extend(bounds[1]);
    mapInstance.fitBounds(merged.pad(0.15));
  }
}

function renderNotice(data) {
  const groups = groupedDataFromPayload(data);
  emptyState.classList.add("hidden");
  noticeCard.classList.remove("hidden");

  statusText.textContent = `Показан е бюлетинът за ${formatDateDisplay(data.notice_date)}.`;
  noticeMunicipality.textContent = data.municipality || "Водоснабдяване - Дунав ЕООД гр. Разград";
  noticeTitle.textContent = "Бюлетин за аварии и ремонти";
  noticeDate.textContent = data.notice_date_display || data.notice_date || "-";
  noticeTime.textContent = data.time_from && data.time_to ? `${data.time_from} - ${data.time_to}` : "-";
  noticeCount.textContent = String(data.dry_feature_count || 0);
  noticeText.textContent = data.text || "Няма текст на бюлетина.";
  publishedAt.textContent = formatDateTime(data.updated_at || data.published_at);

  renderGroupedSettlements(groups);
  renderMap(data);
}

function chooseInitialDate(dates) {
  const values = (Array.isArray(dates) ? dates : []).map((entry) => String((entry && entry.date) || "").trim()).filter(Boolean).sort();
  if (!values.length) {
    return "";
  }

  const fromQuery = new URLSearchParams(window.location.search).get("date");
  if (fromQuery && values.includes(fromQuery)) {
    return fromQuery;
  }

  const today = localDateKey(new Date());
  if (values.includes(today)) {
    return today;
  }

  const upcoming = values.find((date) => date >= today);
  if (upcoming) {
    return upcoming;
  }

  return values[values.length - 1];
}

function setSelectedDate(dateValue) {
  selectedDate = dateValue || "";
  if (selectedDate) {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("date", selectedDate);
    history.replaceState({}, "", nextUrl);
  }
  renderCalendar();
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function startOfCalendarMonth(date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const weekday = (first.getDay() + 6) % 7;
  first.setDate(first.getDate() - weekday);
  return first;
}

function renderCalendar() {
  if (!visibleMonth) {
    visibleMonth = selectedDate ? new Date(`${selectedDate}T00:00:00`) : new Date();
  }

  calendarMonthLabel.textContent = visibleMonth.toLocaleDateString("bg-BG", {
    month: "long",
    year: "numeric",
  });

  calendarGrid.innerHTML = "";
  const cursor = startOfCalendarMonth(visibleMonth);
  const activeMonthKey = monthKey(visibleMonth);

  for (let index = 0; index < 42; index += 1) {
    const loopDate = new Date(cursor);
    const dateValue = localDateKey(loopDate);
    const entry = availableDateMap.get(dateValue);
    const isCurrentMonth = monthKey(loopDate) === activeMonthKey;
    const dayBtn = document.createElement("button");
    dayBtn.type = "button";
    dayBtn.className = "calendar-day";
    if (!isCurrentMonth) {
      dayBtn.classList.add("outside-month");
    }
    if (entry) {
      dayBtn.classList.add("has-event");
    }
    if (dateValue === selectedDate) {
      dayBtn.classList.add("selected");
    }

    const number = document.createElement("span");
    number.className = "calendar-day-number";
    number.textContent = String(loopDate.getDate());
    dayBtn.appendChild(number);

    const meta = document.createElement("span");
    meta.className = "calendar-day-meta";
    meta.textContent = entry ? `${entry.time_from || ""}${entry.time_to ? `-${entry.time_to}` : ""}`.replace(/^-|-$|--/g, "") : "";
    dayBtn.appendChild(meta);

    dayBtn.addEventListener("click", async () => {
      visibleMonth = new Date(loopDate.getFullYear(), loopDate.getMonth(), 1);
      if (entry) {
        setSelectedDate(dateValue);
        await loadNotice(dateValue);
      } else {
        setSelectedDate(dateValue);
        emptyState.classList.remove("hidden");
        noticeCard.classList.add("hidden");
        mapCard.classList.add("hidden");
        statusText.textContent = `Няма публикуван бюлетин за ${formatDateDisplay(dateValue)}.`;
        emptyState.innerHTML = `
          <h2>Няма публикуван бюлетин за избраната дата</h2>
          <p>Избери удебелена дата от календара, за да видиш публикувано събитие.</p>
        `;
      }
    });

    calendarGrid.appendChild(dayBtn);
    cursor.setDate(cursor.getDate() + 1);
  }
}

async function loadCalendar() {
  const response = await fetch("/.netlify/functions/list-outage-dates", {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = await response.json();
  availableEntries = Array.isArray(payload.dates) ? payload.dates : [];
  availableDateMap = new Map(
    availableEntries
      .map((entry) => [String((entry && entry.date) || "").trim(), entry])
      .filter(([date]) => date),
  );
  selectedDate = chooseInitialDate(availableEntries);
  if (selectedDate) {
    visibleMonth = new Date(`${selectedDate}T00:00:00`);
  }
  renderCalendar();
}

async function loadNotice(dateValue) {
  if (!dateValue) {
    emptyState.classList.remove("hidden");
    emptyState.innerHTML = `
      <h2>Няма публикувани бюлетини</h2>
      <p>Когато бъде публикуван бюлетин, той ще се покаже тук и датата ще се отбележи в календара.</p>
    `;
    statusText.textContent = "Все още няма публикувани бюлетини.";
    noticeCard.classList.add("hidden");
    mapCard.classList.add("hidden");
    return;
  }

  const response = await fetch(`/.netlify/functions/get-current-outage?date=${encodeURIComponent(dateValue)}`, {
    headers: { Accept: "application/json" },
  });

  if (response.status === 404) {
    emptyState.classList.remove("hidden");
    noticeCard.classList.add("hidden");
    mapCard.classList.add("hidden");
    statusText.textContent = `Няма публикуван бюлетин за ${formatDateDisplay(dateValue)}.`;
    return;
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = await response.json();
  renderNotice(payload);
}

prevMonthBtn.addEventListener("click", () => {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1);
  renderCalendar();
});

nextMonthBtn.addEventListener("click", () => {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
  renderCalendar();
});

async function bootstrap() {
  try {
    await loadCalendar();
    await loadNotice(selectedDate);
  } catch (error) {
    statusText.textContent = "Не успях да заредя бюлетините.";
    emptyState.classList.remove("hidden");
    emptyState.innerHTML = `
      <h2>Възникна проблем при зареждане</h2>
      <p>${error.message}</p>
    `;
  }
}

bootstrap();
