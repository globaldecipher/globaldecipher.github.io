(function (root) {
  "use strict";

  const WIDTH = 1080;
  const HEIGHT = 1350;
  const MAP = { x: 32, y: 228, width: 676, height: 950 };
  const MAP_BOUNDS = { west: 60.5, east: 78.1, north: 37.5, south: 23.4 };
  const CARD_AREA = { top: 232, bottom: 1218, gap: 16 };
  const CARD_COLUMNS = {
    left: { x: 18, width: 330 },
    right: { x: 718, width: 344 }
  };
  const PROVINCE_META = {
    "khyber-pakhtunkhwa": {
      name: "Khyber Pakhtunkhwa", short: "KP", color: "#6d3684",
      latitude: 34.15, longitude: 71.75, side: "right", cardTop: 234,
      labelLatitude: 34.58, labelLongitude: 70.75, mapLabel: "Khyber Pakhtunkhwa"
    },
    balochistan: {
      name: "Balochistan", short: "BALOCHISTAN", color: "#c38a22",
      latitude: 28.35, longitude: 65.45, side: "left", cardTop: 244,
      labelLatitude: 29.05, labelLongitude: 66.35, mapLabel: "Balochistan"
    },
    punjab: {
      name: "Punjab", short: "PUNJAB", color: "#a3222b",
      latitude: 31.35, longitude: 72.85, side: "right", cardTop: 764,
      labelLatitude: 31.25, labelLongitude: 71.35, mapLabel: "Punjab"
    },
    sindh: {
      name: "Sindh", short: "SINDH", color: "#247378",
      latitude: 26.45, longitude: 68.55, side: "left", cardTop: 770,
      labelLatitude: 25.85, labelLongitude: 68.05, mapLabel: "Sindh"
    },
    "gilgit-baltistan": {
      name: "Gilgit-Baltistan", short: "GB", color: "#314d71",
      latitude: 35.75, longitude: 74.55, side: "right", cardTop: 234,
      labelLatitude: 35.85, labelLongitude: 73.75, mapLabel: "Gilgit-Baltistan"
    },
    islamabad: {
      name: "Islamabad", short: "ICT", color: "#605348",
      latitude: 33.69, longitude: 73.06, side: "right", mapLabel: "Islamabad"
    },
    "azad-jammu-and-kashmir": {
      name: "Azad Jammu and Kashmir", short: "AJK", color: "#49705a",
      latitude: 33.55, longitude: 73.85, side: "right", cardTop: 670,
      labelLatitude: 33.35, labelLongitude: 74.05, mapLabel: "Azad Kashmir"
    }
  };

  function xml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function compact(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  }

  function provinceKey(value) {
    const normalized = compact(value)
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (["kp", "kpk", "khyber-pakhtunkhwa"].includes(normalized)) return "khyber-pakhtunkhwa";
    if (["gb", "gilgit-baltistan", "northern-areas"].includes(normalized)) return "gilgit-baltistan";
    if (["ict", "islamabad-capital-territory", "f-c-t"].includes(normalized)) return "islamabad";
    if (["ajk", "azad-kashmir", "azad-jammu-and-kashmir"].includes(normalized)) {
      return "azad-jammu-and-kashmir";
    }
    return normalized || "pakistan";
  }

  function categoryStyle(category) {
    const value = compact(category).toLowerCase();
    if (/counter|intelligence|operation|ibo/.test(value)) return { color: "#c1842d", code: "CT" };
    if (/ied|explosion|suicide|vbied|grenade/.test(value)) return { color: "#8d1721", code: "IED" };
    if (/drone|quadcopter|uav/.test(value)) return { color: "#2f3640", code: "UAV" };
    if (/kidnap|abduct/.test(value)) return { color: "#b53c36", code: "KID" };
    if (/target|shoot|armed|attack|clash/.test(value)) return { color: "#bd2430", code: "ATK" };
    return { color: "#56616d", code: "SEC" };
  }

  function formatDate(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return compact(value);
    const date = new Date(`${value}T00:00:00Z`);
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      day: "numeric",
      month: "long",
      year: "numeric"
    }).format(date);
  }

  function shortSummary(value, maximum = 150) {
    const text = compact(value);
    if (text.length <= maximum) return text;
    return `${text.slice(0, maximum - 1).replace(/\s+\S*$/, "")}…`;
  }

  function wrapWords(value, maximumCharacters, maximumLines) {
    const words = compact(value).split(" ").filter(Boolean);
    const lines = [];
    let line = "";
    for (const word of words) {
      if (word.length > maximumCharacters && !line) {
        lines.push(`${word.slice(0, Math.max(1, maximumCharacters - 1))}…`);
        if (lines.length === maximumLines) break;
        continue;
      }
      const next = line ? `${line} ${word}` : word;
      if (next.length <= maximumCharacters || !line) {
        line = next;
        continue;
      }
      lines.push(line);
      line = word;
      if (lines.length === maximumLines) break;
    }
    if (lines.length < maximumLines && line) lines.push(line);
    const consumed = lines.join(" ").length;
    if (consumed < compact(value).length && lines.length) {
      lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.,;:]?$/, "")}…`;
    }
    return lines.slice(0, maximumLines);
  }

  function average(values) {
    const numbers = values.map(Number).filter(Number.isFinite);
    return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
  }

  function provinceHeadingLines(group) {
    const province = group.short && group.short !== group.province.toUpperCase()
      ? `${group.province.toUpperCase()} (${group.short})`
      : group.province.toUpperCase();
    const incidentWord = group.incidents.length === 1 ? "INCIDENT" : "INCIDENTS";
    return [
      province,
      `${incidentWord} ${group.incidents.map((incident) => incident.number).join(", ")}`
    ];
  }

  function groupProvinces(incidents) {
    const groups = [];
    const byKey = new Map();
    (incidents || []).forEach((sourceIncident, index) => {
      const incident = { ...sourceIncident, number: index + 1 };
      const key = provinceKey(incident.province);
      const meta = PROVINCE_META[key];
      let group = byKey.get(key);
      if (!group) {
        group = {
          key,
          province: meta?.name || compact(incident.province) || "Pakistan",
          short: meta?.short || compact(incident.province).toUpperCase() || "PAKISTAN",
          incidents: [],
          latitudes: [],
          longitudes: [],
          style: {
            color: meta?.color || "#59656f",
            code: meta?.short || "PK"
          },
          side: meta?.side || ""
        };
        groups.push(group);
        byKey.set(key, group);
      }
      group.incidents.push(incident);
      group.latitudes.push(incident.latitude);
      group.longitudes.push(incident.longitude);
    });
    return groups.map((group) => {
      const meta = PROVINCE_META[group.key];
      return {
        ...group,
        latitude: meta?.latitude ?? average(group.latitudes),
        longitude: meta?.longitude ?? average(group.longitudes)
      };
    }).sort((a, b) => {
      const latitudeDifference = (Number(b.latitude) || -90) - (Number(a.latitude) || -90);
      if (latitudeDifference) return latitudeDifference;
      return a.province.localeCompare(b.province);
    });
  }

  const groupIncidents = groupProvinces;

  function projectMarker(latitude, longitude) {
    const lat = Math.min(MAP_BOUNDS.north, Math.max(MAP_BOUNDS.south, Number(latitude) || 30.3753));
    const lng = Math.min(MAP_BOUNDS.east, Math.max(MAP_BOUNDS.west, Number(longitude) || 69.3451));
    return {
      x: MAP.x + ((lng - MAP_BOUNDS.west) / (MAP_BOUNDS.east - MAP_BOUNDS.west)) * MAP.width,
      y: MAP.y + ((MAP_BOUNDS.north - lat) / (MAP_BOUNDS.north - MAP_BOUNDS.south)) * MAP.height
    };
  }

  function textLines(lines, x, y, options = {}) {
    const size = options.size || 24;
    const lineHeight = options.lineHeight || Math.round(size * 1.24);
    const weight = options.weight || 500;
    const fill = options.fill || "#171a1f";
    const anchor = options.anchor || "start";
    const stroke = options.stroke
      ? ` stroke="${options.stroke}" stroke-width="${options.strokeWidth || 3}" paint-order="stroke" stroke-linejoin="round"`
      : "";
    return `<text x="${x}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${stroke}>${lines.map((line, index) => `<tspan x="${x}" dy="${index ? lineHeight : 0}">${xml(line)}</tspan>`).join("")}</text>`;
  }

  function statBlock(x, label, value, color) {
    return `<g transform="translate(${x} 177)">
      <circle cx="0" cy="0" r="24" fill="${color}"/>
      <circle cx="0" cy="0" r="8" fill="#fff" opacity=".94"/>
      <text x="38" y="-5" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="700" fill="#4d555d">${xml(label)}</text>
      <text x="38" y="23" font-family="Arial, Helvetica, sans-serif" font-size="29" font-weight="850" fill="#15181d">${xml(value)}</text>
    </g>`;
  }

  function cardMetrics(group, maximumHeight) {
    const incidentCount = Math.max(1, group.incidents.length);
    const perIncidentRoom = Math.max(54, (maximumHeight - 78) / incidentCount);
    const compactMode = incidentCount >= 6 || perIncidentRoom < 86;
    const headingSize = compactMode ? 16 : 18;
    const bodySize = compactMode ? 14 : 15;
    const labelSize = compactMode ? 14 : 15;
    const headingLineHeight = headingSize + 5;
    const bodyLineHeight = bodySize + 5;
    const labelLineHeight = labelSize + 4;
    const labelLineBudget = perIncidentRoom >= 72 ? 2 : 1;
    const summaryLineBudget = perIncidentRoom >= 112 ? 2 : 1;
    const headingLines = provinceHeadingLines(group);
    const items = group.incidents.map((incident) => {
      const district = compact(incident.district) || "Pakistan";
      const location = compact(incident.location_label || incident.locality);
      const locationAddsDetail = location && location.toLowerCase() !== district.toLowerCase();
      const label = locationAddsDetail ? `${district} — ${location}` : district;
      const labelLines = wrapWords(label.toUpperCase(), compactMode ? 31 : 28, labelLineBudget);
      const summaryLines = wrapWords(
        shortSummary(incident.summary || incident.category || incident.incident_type, 150),
        compactMode ? 37 : 34,
        summaryLineBudget
      );
      const height = 13
        + labelLines.length * labelLineHeight
        + (summaryLines.length ? 4 + summaryLines.length * bodyLineHeight : 0)
        + 11;
      return { incident, labelLines, summaryLines, height };
    });
    const headerHeight = 77;
    const desiredHeight = headerHeight + items.reduce((total, item) => total + item.height, 0) + 5;
    return {
      headingLines,
      items,
      headingSize,
      headingLineHeight,
      bodySize,
      bodyLineHeight,
      labelSize,
      labelLineHeight,
      headerHeight,
      height: Math.min(maximumHeight, Math.max(150, desiredHeight))
    };
  }

  function assignSide(group, sideWeights) {
    if (group.side) return group.side;
    if (Number.isFinite(Number(group.longitude))) {
      return Number(group.longitude) < 69.8 ? "left" : "right";
    }
    return sideWeights.left <= sideWeights.right ? "left" : "right";
  }

  function layoutSide(groups, side) {
    if (!groups.length) return [];
    const availableHeight = CARD_AREA.bottom - CARD_AREA.top;
    const cardSpace = availableHeight - CARD_AREA.gap * Math.max(0, groups.length - 1);
    const weights = groups.map((group) => 88 + group.incidents.length * 72);
    const totalWeight = weights.reduce((total, value) => total + value, 0);
    const column = CARD_COLUMNS[side];
    const cards = groups
      .map((group, index) => {
        const marker = projectMarker(group.latitude, group.longitude);
        const allocation = Math.max(150, Math.floor(cardSpace * (weights[index] / totalWeight)));
        const metrics = cardMetrics(group, allocation);
        const preferredTop = PROVINCE_META[group.key]?.cardTop;
        return {
          group,
          marker,
          metrics,
          side,
          x: column.x,
          width: column.width,
          y: Math.max(
            CARD_AREA.top,
            Math.min(
              CARD_AREA.bottom - metrics.height,
              Number.isFinite(preferredTop) ? preferredTop : marker.y - metrics.height / 2
            )
          )
        };
      })
      .sort((a, b) => a.y - b.y || a.marker.y - b.marker.y);
    for (let index = 1; index < cards.length; index += 1) {
      const earliest = cards[index - 1].y + cards[index - 1].metrics.height + CARD_AREA.gap;
      cards[index].y = Math.max(cards[index].y, earliest);
    }
    const overflow = cards[cards.length - 1].y + cards[cards.length - 1].metrics.height - CARD_AREA.bottom;
    if (overflow > 0) cards.forEach((card) => { card.y -= overflow; });
    for (let index = cards.length - 2; index >= 0; index -= 1) {
      const latest = cards[index + 1].y - CARD_AREA.gap - cards[index].metrics.height;
      cards[index].y = Math.min(cards[index].y, latest);
    }
    const topOverflow = CARD_AREA.top - cards[0].y;
    if (topOverflow > 0) cards.forEach((card) => { card.y += topOverflow; });
    return cards;
  }

  function layoutGroups(groups) {
    const sideWeights = { left: 0, right: 0 };
    const bySide = { left: [], right: [] };
    groups.forEach((group) => {
      const side = assignSide(group, sideWeights);
      bySide[side].push(group);
      sideWeights[side] += group.incidents.length;
    });
    return [
      ...layoutSide(bySide.left, "left"),
      ...layoutSide(bySide.right, "right")
    ].sort((a, b) => a.marker.y - b.marker.y);
  }

  function cardFor(card) {
    const { group, marker, metrics, side, x, y, width } = card;
    const height = metrics.height;
    const cardEdgeX = side === "left" ? x + width : x;
    const elbowX = side === "left" ? cardEdgeX + 18 : cardEdgeX - 18;
    const lineY = Math.max(y + 35, Math.min(y + height - 35, marker.y));
    const clipId = `card-clip-${group.key}`;
    const badgeY = y + 36;
    const heading = textLines(metrics.headingLines, x + 66, y + 30, {
      size: metrics.headingSize,
      lineHeight: metrics.headingLineHeight,
      weight: 850,
      fill: group.style.color
    });
    let cursorY = y + metrics.headerHeight;
    const itemText = metrics.items.map((item, itemIndex) => {
      const itemTop = cursorY;
      const badgeCenterY = itemTop + 21;
      const label = textLines(item.labelLines, x + 55, itemTop + 18, {
        size: metrics.labelSize,
        lineHeight: metrics.labelLineHeight,
        weight: 800,
        fill: "#1d2730"
      });
      const summaryY = itemTop + 18 + item.labelLines.length * metrics.labelLineHeight + 4;
      const summary = textLines(item.summaryLines, x + 55, summaryY, {
        size: metrics.bodySize,
        lineHeight: metrics.bodyLineHeight,
        weight: 500,
        fill: "#46515a"
      });
      cursorY += item.height;
      const separator = itemIndex < metrics.items.length - 1
        ? `<line x1="${x + 22}" y1="${cursorY}" x2="${x + width - 22}" y2="${cursorY}" stroke="#dfe2e2" stroke-width="1"/>`
        : "";
      return `<circle cx="${x + 29}" cy="${badgeCenterY}" r="16" fill="${group.style.color}"/>
        <text x="${x + 29}" y="${badgeCenterY + 6}" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="850" fill="#fff" text-anchor="middle">${item.incident.number}</text>
        ${label}${summary}${separator}`;
    }).join("");
    return `<g>
        <polyline points="${cardEdgeX},${lineY} ${elbowX},${lineY} ${marker.x},${marker.y}" fill="none" stroke="${group.style.color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" opacity=".9"/>
        <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="18" fill="#fffefb" stroke="#d5d7d4" stroke-width="1.5" filter="url(#shadow)"/>
        <path d="M ${x + 18} ${y + 2} H ${x + width - 18}" stroke="${group.style.color}" stroke-width="5" stroke-linecap="round"/>
        <clipPath id="${clipId}"><rect x="${x + 3}" y="${y + 3}" width="${width - 6}" height="${height - 6}" rx="15"/></clipPath>
        <circle cx="${x + 31}" cy="${badgeY}" r="23" fill="${group.style.color}"/>
        <text x="${x + 31}" y="${badgeY + 7}" font-family="Arial, Helvetica, sans-serif" font-size="19" font-weight="850" fill="#fff" text-anchor="middle">${group.incidents.length}</text>
        <line x1="${x + 20}" y1="${y + metrics.headerHeight - 1}" x2="${x + width - 20}" y2="${y + metrics.headerHeight - 1}" stroke="${group.style.color}" stroke-width="1.5" opacity=".55"/>
        <g clip-path="url(#${clipId})">
        ${heading}
        ${itemText}
        </g>
      </g>`;
  }

  function stripOuterSvg(svgText) {
    const match = String(svgText || "").match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/i);
    return match ? match[1] : "";
  }

  function mapProvinceLabels() {
    return Object.values(PROVINCE_META)
      .filter((meta) => meta.short !== "ICT")
      .map((meta) => {
        const point = projectMarker(
          meta.labelLatitude ?? meta.latitude,
          meta.labelLongitude ?? meta.longitude
        );
        const lines = meta.short === "KP"
          ? ["Khyber", "Pakhtunkhwa"]
          : meta.short === "GB"
            ? ["Gilgit-", "Baltistan"]
            : [meta.mapLabel];
        return textLines(lines, point.x, point.y, {
          size: meta.short === "AJK" ? 13 : 15,
          lineHeight: 17,
          weight: 800,
          fill: "#3d474f",
          anchor: "middle",
          stroke: "#f8f6ef",
          strokeWidth: 4
        });
      }).join("");
  }

  function buildInfographicSvg(data, assets = {}) {
    const displayedIncidents = (data.incidents || []).slice(0, 10);
    const groups = groupProvinces(displayedIncidents);
    const cards = layoutGroups(groups);
    const markers = cards.map(({ marker, group }) => `<g class="province-marker" data-province="${xml(group.province)}">
      <circle cx="${marker.x}" cy="${marker.y}" r="23" fill="${group.style.color}" stroke="#fff" stroke-width="5" filter="url(#shadow)"/>
      <circle cx="${marker.x}" cy="${marker.y}" r="7" fill="#fff" opacity=".94"/>
    </g>`).join("");
    const logo = assets.logoDataUrl
      ? `<image href="${xml(assets.logoDataUrl)}" x="792" y="28" width="250" height="82" preserveAspectRatio="xMidYMid meet"/>`
      : `<text x="1038" y="70" font-family="Arial, Helvetica, sans-serif" font-size="25" font-weight="900" fill="#8d1721" text-anchor="end">THE GLOBAL DECIPHER</text>`;
    const omitted = Math.max(0, Number(data.total_incidents || 0) - displayedIncidents.length);
    const omissionNote = omitted
      ? `<text x="540" y="1247" font-family="Arial, Helvetica, sans-serif" font-size="17" font-weight="700" fill="#8d1721" text-anchor="middle">Showing 10 incidents · ${omitted} additional published incident${omitted === 1 ? "" : "s"} included in totals</text>`
      : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
      <defs>
        <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#26303a" flood-opacity=".18"/>
        </filter>
        <filter id="softShadow" x="-20%" y="-40%" width="140%" height="180%">
          <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#26303a" flood-opacity=".12"/>
        </filter>
        <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#faf8f1"/>
          <stop offset="1" stop-color="#f2f5f5"/>
        </linearGradient>
      </defs>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#paper)"/>
      <rect x="0" y="0" width="${WIDTH}" height="12" fill="#981b27"/>
      <text x="42" y="78" font-family="Arial, Helvetica, sans-serif" font-size="36" font-weight="900" fill="#11151a">Security &amp; Terrorism Incidents</text>
      <text x="42" y="117" font-family="Arial, Helvetica, sans-serif" font-size="27" font-weight="500" fill="#4b5158">${xml(formatDate(data.date))}</text>
      ${logo}
      <line x1="42" y1="132" x2="1038" y2="132" stroke="#d8d2c5" stroke-width="2"/>
      <rect x="28" y="142" width="1024" height="72" rx="16" fill="#fffefb" stroke="#ddd8ce" stroke-width="1.5" filter="url(#softShadow)"/>
      <line x1="282" y1="153" x2="282" y2="203" stroke="#ddd8ce"/>
      <line x1="540" y1="153" x2="540" y2="203" stroke="#ddd8ce"/>
      <line x1="798" y1="153" x2="798" y2="203" stroke="#ddd8ce"/>
      ${statBlock(64, "Incidents", data.total_incidents || 0, "#142c49")}
      ${statBlock(322, "Killed", data.killed || 0, "#b20e18")}
      ${statBlock(580, "Injured", data.injured || 0, "#6d3684")}
      ${statBlock(838, "Arrested", data.arrested || 0, "#c38a22")}
      <svg x="${MAP.x}" y="${MAP.y}" width="${MAP.width}" height="${MAP.height}" viewBox="0 0 112 100" preserveAspectRatio="none">
        <style>
          .country { fill: #f4f1e9 !important; }
          .province { fill: #e5e5df !important; stroke: #89939a !important; stroke-width: .9 !important; stroke-opacity: .95 !important; vector-effect: non-scaling-stroke; }
          .province[data-region="Khyber Pakhtunkhwa"] { fill: #e4e2e7 !important; stroke: none !important; }
          .province[data-region="Balochistan"] { fill: #e8e5dd !important; }
          .province[data-region="Punjab"] { fill: #e3e6e2 !important; }
          .province[data-region="Sindh"] { fill: #e7e5df !important; }
          .province[data-region="Gilgit-Baltistan"] { fill: #e2e6e8 !important; }
          .claimed-kashmir { fill: #ece7dd !important; stroke: #6f7a82 !important; stroke-width: .9 !important; vector-effect: non-scaling-stroke; }
          .border { stroke: #24313a !important; stroke-width: 1.8 !important; vector-effect: non-scaling-stroke; }
        </style>
        ${assets.mapInner || ""}
      </svg>
      ${mapProvinceLabels()}
      ${cards.map(cardFor).join("")}
      ${markers}
      ${groups.length ? "" : `<text x="540" y="650" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="800" fill="#626a72" text-anchor="middle">No published incidents recorded</text>`}
      ${omissionNote}
      <line x1="42" y1="1272" x2="1038" y2="1272" stroke="#d8d2c5" stroke-width="2"/>
      <text x="42" y="1310" font-family="Arial, Helvetica, sans-serif" font-size="19" font-weight="700" fill="#333a42">Source: The Global Decipher</text>
      <text x="1038" y="1310" font-family="Arial, Helvetica, sans-serif" font-size="19" font-weight="700" fill="#8d1721" text-anchor="end">theglobaldecipher.com</text>
      <text x="42" y="1335" font-family="Arial, Helvetica, sans-serif" font-size="14" font-weight="500" fill="#777d83">Published records as generated from the TGD incident database · Pakistan time</text>
    </svg>`;
  }

  async function blobAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("Could not read image asset."));
      reader.readAsDataURL(blob);
    });
  }

  async function loadAssets(options = {}) {
    const [mapResponse, logoResponse] = await Promise.all([
      fetch(options.mapUrl || "/assets/pakistan-map.svg"),
      fetch(options.logoUrl || "/assets/brand/tgd-logo-header-v2.png")
    ]);
    if (!mapResponse.ok) throw new Error("Pakistan map asset could not be loaded.");
    if (!logoResponse.ok) throw new Error("TGD logo asset could not be loaded.");
    return {
      mapInner: stripOuterSvg(await mapResponse.text()),
      logoDataUrl: await blobAsDataUrl(await logoResponse.blob())
    };
  }

  async function svgToPng(svg) {
    const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl = URL.createObjectURL(svgBlob);
    try {
      const image = new Image();
      image.decoding = "async";
      image.src = svgUrl;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      const context = canvas.getContext("2d", { alpha: false });
      context.fillStyle = "#faf8f1";
      context.fillRect(0, 0, WIDTH, HEIGHT);
      context.drawImage(image, 0, 0, WIDTH, HEIGHT);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("The browser could not create the PNG.");
      return blob;
    } finally {
      URL.revokeObjectURL(svgUrl);
    }
  }

  async function generateInfographicPng(data, options = {}) {
    const assets = await loadAssets(options);
    const svg = buildInfographicSvg(data, assets);
    return { blob: await svgToPng(svg), svg, groups: groupIncidents(data.incidents || []) };
  }

  root.TGDInfographic = {
    WIDTH,
    HEIGHT,
    buildInfographicSvg,
    categoryStyle,
    formatDate,
    generateInfographicPng,
    groupIncidents,
    groupProvinces,
    layoutGroups,
    mapProvinceLabels,
    projectMarker,
    provinceHeadingLines,
    stripOuterSvg,
    wrapWords
  };
})(typeof window !== "undefined" ? window : globalThis);
