(function (root) {
  "use strict";

  const WIDTH = 1080;
  const HEIGHT = 1350;
  const MAP = { x: 292, y: 286, width: 496, height: 720 };
  const MAP_BOUNDS = { west: 60.5, east: 78.1, north: 37.5, south: 23.4 };
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
    return [
      compact(incident?.district).toLowerCase(),
      compact(incident?.location_label || incident?.locality).toLowerCase()
    ].join("|");
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

  function groupIncidents(incidents) {
    const groups = [];
    const byKey = new Map();
    for (const incident of incidents || []) {
      const key = locationKey(incident) || `incident-${groups.length}`;
      let group = byKey.get(key);
      if (!group) {
        group = {
          district: compact(incident.district) || "Pakistan",
          location: compact(incident.location_label || incident.locality),
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
    return groups.map((group, index) => ({
      ...group,
      number: index + 1,
      latitude: average(group.latitudes),
      longitude: average(group.longitudes),
      style: categoryStyle(group.categories[0])
    }));
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

  function cardFor(group, index, side, slot, slotsOnSide) {
    const x = side === "left" ? 22 : 736;
    const width = 322;
    const top = 260;
    const available = 875;
    const gap = 14;
    const height = Math.min(166, Math.max(112, (available - Math.max(0, slotsOnSide - 1) * gap) / Math.max(1, slotsOnSide)));
    const step = slotsOnSide > 1 ? (available - height) / (slotsOnSide - 1) : 0;
    const y = slotsOnSide === 1 ? top + (available - height) * 0.42 : top + slot * step;
    const headerLocation = group.location ? ` (${group.location})` : "";
    const province = PROVINCE_SHORT[group.province] || group.province.toUpperCase() || "PAKISTAN";
    const heading = `(${index + 1}) ${group.district.toUpperCase()}${headerLocation} — ${province}`;
    const headingLines = wrapWords(heading, 31, 2);
    const summaryStart = y + 62 + (headingLines.length - 1) * 25;
    const availableSummaryLines = Math.max(1, Math.floor((height - (summaryStart - y) - 12) / 24));
    const summaries = [];
    const perItemLines = Math.max(1, Math.floor(availableSummaryLines / group.incidents.length));
    group.incidents.forEach((incident, itemIndex) => {
      const prefix = group.incidents.length > 1 ? `${String.fromCharCode(65 + itemIndex)}) ` : "";
      summaries.push(...wrapWords(`${prefix}${shortSummary(incident.summary)}`, 34, perItemLines));
    });
    const marker = projectMarker(group.latitude, group.longitude);
    const cardEdgeX = side === "left" ? x + width : x;
    const elbowX = side === "left" ? MAP.x - 20 : MAP.x + MAP.width + 20;
    const lineY = y + Math.min(height * 0.55, 82);
    return {
      marker,
      svg: `<g>
        <polyline points="${cardEdgeX},${lineY} ${elbowX},${lineY} ${marker.x},${marker.y}" fill="none" stroke="${group.style.color}" stroke-width="3" stroke-linejoin="round" opacity=".9"/>
        <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="18" fill="#fffefb" stroke="${group.style.color}" stroke-width="3" filter="url(#shadow)"/>
        <circle cx="${x}" cy="${y + 24}" r="22" fill="${group.style.color}"/>
        <text x="${x}" y="${y + 30}" font-family="Arial, Helvetica, sans-serif" font-size="${group.style.code.length > 2 ? 10 : 13}" font-weight="800" fill="#fff" text-anchor="middle">${xml(group.style.code)}</text>
        ${textLines(headingLines, x + 22, y + 32, { size: 22, lineHeight: 25, weight: 800 })}
        ${textLines(summaries, x + 22, summaryStart, { size: 19, lineHeight: 24, weight: 500 })}
      </g>`
    };
  }

  function stripOuterSvg(svgText) {
    const match = String(svgText || "").match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/i);
    return match ? match[1] : "";
  }

  function buildInfographicSvg(data, assets = {}) {
    const displayedIncidents = (data.incidents || []).slice(0, 10);
    const groups = groupIncidents(displayedIncidents).map((group, index) => ({ ...group, number: index + 1 }));
    const leftCount = Math.min(5, Math.ceil(groups.length / 2));
    const rightCount = Math.max(0, groups.length - leftCount);
    const cards = [];
    groups.forEach((group, index) => {
      const side = index < leftCount ? "left" : "right";
      const slot = side === "left" ? index : index - leftCount;
      const result = cardFor(group, index, side, slot, side === "left" ? leftCount : rightCount);
      cards.push({ ...result, group });
    });
    const markers = cards.map(({ marker, group }, index) => `<g>
      <circle cx="${marker.x}" cy="${marker.y}" r="21" fill="${group.style.color}" stroke="#fff" stroke-width="4" filter="url(#shadow)"/>
      <text x="${marker.x}" y="${marker.y + 8}" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="800" fill="#fff" text-anchor="middle">${index + 1}</text>
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
        ${assets.mapInner || ""}
      </svg>
      ${cards.map((card) => card.svg).join("")}
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
    projectMarker,
    stripOuterSvg,
    wrapWords
  };
})(typeof window !== "undefined" ? window : globalThis);
