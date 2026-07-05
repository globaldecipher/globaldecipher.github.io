(function (root) {
  "use strict";

  const WIDTH = 1080;
  const HEIGHT = 1350;
  const MAP = { x: 235, y: 238, width: 610, height: 900 };
  const MAP_BOUNDS = { west: 60.5, east: 78.1, north: 37.5, south: 23.4 };
  const CARD_AREA = { top: 228, bottom: 1228, gap: 14 };
  const CARD_COLUMNS = {
    left: { x: 18, width: 354 },
    right: { x: 708, width: 354 }
  };
  const PROVINCE_SHORT = {
    "Khyber Pakhtunkhwa": "KP",
    "Balochistan": "BALOCHISTAN",
    "Sindh": "SINDH",
    "Punjab": "PUNJAB",
    "Gilgit-Baltistan": "GB",
    "Islamabad": "ICT",
    "Azad Kashmir": "AJK",
    "Azad Jammu and Kashmir": "AJK"
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

  function locationKey(incident) {
    const district = compact(incident?.district).toLowerCase();
    const province = compact(incident?.province).toLowerCase();
    const fallback = compact(incident?.location_label || incident?.locality).toLowerCase();
    return `${province}|${district || fallback}`;
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

  function headingLinesFor(group, province, maximumCharacters = 27) {
    const districtWords = compact(group.district).toUpperCase().split(" ").filter(Boolean);
    const full = `(${group.number}) ${districtWords.join(" ")} — ${province}`;
    if (full.length <= maximumCharacters || districtWords.length < 2) {
      return wrapWords(full, maximumCharacters, 2);
    }
    let best = null;
    for (let index = 1; index < districtWords.length; index += 1) {
      const lines = [
        `(${group.number}) ${districtWords.slice(0, index).join(" ")}`,
        `${districtWords.slice(index).join(" ")} — ${province}`
      ];
      const score = Math.max(lines[0].length, lines[1].length)
        + Math.abs(lines[0].length - lines[1].length) * 0.15;
      if (!best || score < best.score) best = { lines, score };
    }
    return best.lines;
  }

  function groupIncidents(incidents) {
    const groups = [];
    const byKey = new Map();
    for (const incident of incidents || []) {
      const key = locationKey(incident) || `incident-${groups.length}`;
      let group = byKey.get(key);
      if (!group) {
        group = {
          district: compact(incident.district) || "Pakistan",
          province: compact(incident.province),
          incidents: [],
          categories: [],
          latitudes: [],
          longitudes: []
        };
        groups.push(group);
        byKey.set(key, group);
      }
      group.incidents.push(incident);
      group.categories.push(incident.category || incident.incident_type);
      group.latitudes.push(incident.latitude);
      group.longitudes.push(incident.longitude);
    }
    return groups.map((group) => ({
      ...group,
      latitude: average(group.latitudes),
      longitude: average(group.longitudes),
      style: categoryStyle(group.categories[0])
    }))
      .sort((a, b) => {
        const latitudeDifference = (Number(b.latitude) || -90) - (Number(a.latitude) || -90);
        if (latitudeDifference) return latitudeDifference;
        return a.district.localeCompare(b.district);
      })
      .map((group, index) => ({ ...group, number: index + 1 }));
  }

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
    return `<text x="${x}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${lines.map((line, index) => `<tspan x="${x}" dy="${index ? lineHeight : 0}">${xml(line)}</tspan>`).join("")}</text>`;
  }

  function statBlock(x, label, value, color) {
    return `<g transform="translate(${x} 158)">
      <circle cx="0" cy="0" r="21" fill="${color}"/>
      <circle cx="0" cy="0" r="8" fill="#fff" opacity=".92"/>
      <text x="34" y="8" font-family="Arial, Helvetica, sans-serif" font-size="27" font-weight="800" fill="#15181d">${xml(label)}: ${xml(value)}</text>
    </g>`;
  }

  function cardMetrics(group, maximumHeight) {
    const compactMode = maximumHeight < 185;
    const headingSize = compactMode ? 18 : 20;
    const bodySize = compactMode ? 15 : 17;
    const labelSize = compactMode ? 13 : 14;
    const headingLineHeight = headingSize + 4;
    const bodyLineHeight = bodySize + 5;
    const labelLineHeight = labelSize + 4;
    const province = PROVINCE_SHORT[group.province] || group.province.toUpperCase() || "PAKISTAN";
    const headingLines = headingLinesFor(group, province, compactMode ? 31 : 27);
    const itemLineBudget = compactMode
      ? Math.max(1, Math.floor((maximumHeight - 58 - headingLines.length * headingLineHeight) / Math.max(1, group.incidents.length) / bodyLineHeight))
      : maximumHeight >= 235
        ? group.incidents.length > 1 ? 3 : 4
        : maximumHeight >= 195
          ? group.incidents.length > 1 ? 2 : 3
          : 2;
    const items = [];
    group.incidents.forEach((incident, itemIndex) => {
      const prefix = group.incidents.length > 1 ? `${String.fromCharCode(65 + itemIndex)}) ` : "";
      const location = compact(incident.location_label || incident.locality || incident.category || incident.incident_type);
      const labelLines = wrapWords(`${prefix}${location.toUpperCase()}`, compactMode ? 37 : 33, compactMode ? 1 : 2);
      const summaryLines = wrapWords(shortSummary(incident.summary, 135), compactMode ? 40 : 36, Math.max(1, itemLineBudget));
      items.push({ labelLines, summaryLines });
    });
    const desiredHeight = 38
      + headingLines.length * headingLineHeight
      + items.reduce((total, item) => total
        + item.labelLines.length * labelLineHeight
        + item.summaryLines.length * bodyLineHeight
        + 8, 0)
      + 12;
    return {
      headingLines,
      items,
      headingSize,
      headingLineHeight,
      bodySize,
      bodyLineHeight,
      labelSize,
      labelLineHeight,
      height: Math.min(maximumHeight, Math.max(compactMode ? 142 : 164, desiredHeight))
    };
  }

  function assignSide(group, index, sideCounts) {
    if (Number.isFinite(Number(group.longitude))) {
      return Number(group.longitude) < 69.8 ? "left" : "right";
    }
    return sideCounts.left <= sideCounts.right ? "left" : "right";
  }

  function layoutSide(groups, side) {
    if (!groups.length) return [];
    const availableHeight = CARD_AREA.bottom - CARD_AREA.top;
    const maximumHeight = Math.min(
      270,
      Math.floor((availableHeight - CARD_AREA.gap * Math.max(0, groups.length - 1)) / groups.length)
    );
    const column = CARD_COLUMNS[side];
    const cards = groups
      .map((group) => {
        const marker = projectMarker(group.latitude, group.longitude);
        const metrics = cardMetrics(group, maximumHeight);
        return {
          group,
          marker,
          metrics,
          side,
          x: column.x,
          width: column.width,
          y: Math.max(
            CARD_AREA.top,
            Math.min(CARD_AREA.bottom - metrics.height, marker.y - metrics.height / 2)
          )
        };
      })
      .sort((a, b) => a.marker.y - b.marker.y);
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
    const sideCounts = { left: 0, right: 0 };
    const bySide = { left: [], right: [] };
    groups.forEach((group, index) => {
      const side = assignSide(group, index, sideCounts);
      bySide[side].push(group);
      sideCounts[side] += 1;
    });
    return [
      ...layoutSide(bySide.left, "left"),
      ...layoutSide(bySide.right, "right")
    ].sort((a, b) => a.group.number - b.group.number);
  }

  function cardFor(card) {
    const { group, marker, metrics, side, x, y, width } = card;
    const height = metrics.height;
    const cardEdgeX = side === "left" ? x + width : x;
    const elbowX = side === "left" ? MAP.x - 12 : MAP.x + MAP.width + 12;
    const lineY = Math.max(y + 35, Math.min(y + height - 35, marker.y));
    const clipId = `card-clip-${group.number}`;
    let cursorY = y + 31;
    const heading = textLines(metrics.headingLines, x + 24, cursorY, {
      size: metrics.headingSize,
      lineHeight: metrics.headingLineHeight,
      weight: 850,
      fill: "#1f252b"
    });
    cursorY += metrics.headingLines.length * metrics.headingLineHeight + 10;
    const itemText = metrics.items.map((item) => {
      const label = textLines(item.labelLines, x + 24, cursorY, {
        size: metrics.labelSize,
        lineHeight: metrics.labelLineHeight,
        weight: 800,
        fill: group.style.color
      });
      cursorY += item.labelLines.length * metrics.labelLineHeight + 3;
      const summary = textLines(item.summaryLines, x + 24, cursorY, {
        size: metrics.bodySize,
        lineHeight: metrics.bodyLineHeight,
        weight: 500,
        fill: "#2f353b"
      });
      cursorY += item.summaryLines.length * metrics.bodyLineHeight + 8;
      return `${label}${summary}`;
    }).join("");
    return `<g>
        <polyline points="${cardEdgeX},${lineY} ${elbowX},${lineY} ${marker.x},${marker.y}" fill="none" stroke="${group.style.color}" stroke-width="3" stroke-linejoin="round" opacity=".86"/>
        <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="18" fill="#fffefb" stroke="${group.style.color}" stroke-width="3" filter="url(#shadow)"/>
        <clipPath id="${clipId}"><rect x="${x + 3}" y="${y + 3}" width="${width - 6}" height="${height - 6}" rx="15"/></clipPath>
        <circle cx="${x}" cy="${y + 24}" r="22" fill="${group.style.color}"/>
        <text x="${x}" y="${y + 30}" font-family="Arial, Helvetica, sans-serif" font-size="${group.style.code.length > 2 ? 10 : 13}" font-weight="800" fill="#fff" text-anchor="middle">${xml(group.style.code)}</text>
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

  function buildInfographicSvg(data, assets = {}) {
    const displayedIncidents = (data.incidents || []).slice(0, 10);
    const groups = groupIncidents(displayedIncidents);
    const cards = layoutGroups(groups);
    const markers = cards.map(({ marker, group }) => `<g>
      <circle cx="${marker.x}" cy="${marker.y}" r="21" fill="${group.style.color}" stroke="#fff" stroke-width="4" filter="url(#shadow)"/>
      <text x="${marker.x}" y="${marker.y + 8}" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="800" fill="#fff" text-anchor="middle">${group.number}</text>
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
      ${statBlock(52, "Incidents", data.total_incidents || 0, "#232a32")}
      ${statBlock(302, "Killed", data.killed || 0, "#8d1721")}
      ${statBlock(524, "Injured", data.injured || 0, "#6c356f")}
      ${statBlock(762, "Arrested", data.arrested || 0, "#a17328")}
      <rect x="${MAP.x - 4}" y="${MAP.y - 4}" width="${MAP.width + 8}" height="${MAP.height + 8}" rx="34" fill="#f6f4ed" opacity=".72"/>
      <svg x="${MAP.x}" y="${MAP.y}" width="${MAP.width}" height="${MAP.height}" viewBox="0 0 112 100" preserveAspectRatio="none">
        <style>
          .country { fill: #f1eee6 !important; }
          .province { fill: #dedfdb !important; stroke: #65717a !important; stroke-width: 1.15 !important; stroke-opacity: .98 !important; vector-effect: non-scaling-stroke; }
          .claimed-kashmir { fill: #e3e1db !important; stroke: #37424b !important; stroke-width: 1.15 !important; vector-effect: non-scaling-stroke; }
          .border { stroke: #1d2831 !important; stroke-width: 1.55 !important; vector-effect: non-scaling-stroke; }
        </style>
        ${assets.mapInner || ""}
      </svg>
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
      fetch(options.logoUrl || "/assets/brand/tgd-logo-header.png")
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
    headingLinesFor,
    layoutGroups,
    projectMarker,
    stripOuterSvg,
    wrapWords
  };
})(typeof window !== "undefined" ? window : globalThis);
