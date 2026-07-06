import assert from "node:assert/strict";
import { test } from "node:test";

await import("../../static/admin-infographic.js");

const renderer = globalThis.TGDInfographic;

test("infographic groups every incident in a province into one numbered province card", () => {
  const groups = renderer.groupIncidents([
    {
      district: "Swat",
      location_label: "Shakar Dara, Matta, Swat",
      province: "Khyber Pakhtunkhwa",
      latitude: 35.22,
      longitude: 72.43,
      category: "Armed attack",
      summary: "First incident."
    },
    {
      district: "Swat",
      location_label: "Matta, Swat",
      province: "Khyber Pakhtunkhwa",
      latitude: 35.22,
      longitude: 72.43,
      category: "IED / Explosion",
      summary: "Second incident."
    }
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].incidents.length, 2);
  assert.deepEqual(groups[0].incidents.map((incident) => incident.number), [1, 2]);
  assert.deepEqual(renderer.provinceHeadingLines(groups[0]), [
    "KHYBER PAKHTUNKHWA (KP)",
    "INCIDENTS 1, 2"
  ]);
  const svg = renderer.buildInfographicSvg({
    date: "2026-07-05",
    total_incidents: 2,
    killed: 0,
    injured: 2,
    arrested: 0,
    incidents: groups[0].incidents
  }, { mapInner: "", logoDataUrl: "" });
  assert.match(svg, /KHYBER PAKHTUNKHWA \(KP\)/);
  assert.match(svg, /INCIDENTS 1, 2/);
  assert.match(svg, /SHAKAR DARA, MATTA,/);
  assert.match(svg, /MATTA, SWAT/);
  assert.doesNotMatch(svg, /A\)|B\)/);
});

test("infographic uses one fixed province marker and card per province", () => {
  const groups = renderer.groupIncidents([
    {
      district: "Kech",
      province: "Balochistan",
      latitude: 26,
      longitude: 63.05,
      category: "Counterterrorism operation",
      summary: "Southern incident."
    },
    {
      district: "Swat",
      province: "Khyber Pakhtunkhwa",
      latitude: 35.22,
      longitude: 72.43,
      category: "Armed attack",
      summary: "Northern incident."
    },
    {
      district: "Lower South Waziristan",
      province: "Khyber Pakhtunkhwa",
      latitude: 32.1,
      longitude: 69.36,
      category: "Drone / Quadcopter",
      summary: "Western incident."
    }
  ]);
  assert.deepEqual(groups.map((group) => group.province), [
    "Khyber Pakhtunkhwa",
    "Balochistan"
  ]);
  assert.deepEqual(groups[0].incidents.map((incident) => incident.number), [2, 3]);
  assert.deepEqual(groups[1].incidents.map((incident) => incident.number), [1]);
  const cards = renderer.layoutGroups(groups);
  assert.equal(cards.find((card) => card.group.province === "Khyber Pakhtunkhwa").side, "right");
  assert.equal(cards.find((card) => card.group.province === "Balochistan").side, "left");
  assert.equal(cards.find((card) => card.group.province === "Khyber Pakhtunkhwa").y, 234);
  assert.equal(cards.find((card) => card.group.province === "Balochistan").y, 244);
  assert.ok(
    cards.find((card) => card.group.province === "Khyber Pakhtunkhwa").marker.y
      < cards.find((card) => card.group.province === "Balochistan").marker.y
  );
  assert.deepEqual(
    renderer.provinceHeadingLines(groups[0]),
    ["KHYBER PAKHTUNKHWA (KP)", "INCIDENTS 2, 3"]
  );
});

test("infographic SVG is a single Instagram-size branded canvas", () => {
  const svg = renderer.buildInfographicSvg({
    date: "2026-07-05",
    total_incidents: 2,
    killed: 1,
    injured: 3,
    arrested: 0,
    incidents: [{
      district: "Bajaur",
      locality: "Shindi Mor",
      province: "Khyber Pakhtunkhwa",
      latitude: 34.72,
      longitude: 71.5,
      category: "IED / Explosion",
      summary: "Grenade thrown at a police post; no casualties."
    }]
  }, {
    mapInner: "<path d=\"M0 0h112v100H0z\"/>",
    logoDataUrl: ""
  });
  assert.match(svg, /width="1080" height="1350"/);
  assert.match(svg, /Security &amp; Terrorism Incidents/);
  assert.match(svg, />Incidents<\/text>/);
  assert.match(svg, />2<\/text>/);
  assert.match(svg, /theglobaldecipher\.com/);
  assert.match(svg, /\.province \{ fill: #e5e5df !important; stroke: #89939a !important;/);
  assert.match(svg, /\.province\[data-region="Khyber Pakhtunkhwa"\] \{ fill: #e4e2e7 !important; stroke: none !important; \}/);
  assert.match(svg, /clipPath id="card-clip-khyber-pakhtunkhwa"/);
  assert.match(svg, /class="province-marker" data-province="Khyber Pakhtunkhwa"/);
  assert.match(svg, /Khyber/);
  assert.match(svg, /Pakhtunkhwa/);
  assert.doesNotMatch(svg, /page 2/i);
});

test("infographic keeps one PNG and clearly caps the visible list at ten incidents", () => {
  const incidents = Array.from({ length: 11 }, (_, index) => ({
    district: `District ${index + 1}`,
    locality: `Locality ${index + 1}`,
    province: "Khyber Pakhtunkhwa",
    latitude: 30 + index * 0.1,
    longitude: 69 + index * 0.1,
    category: "Armed attack",
    summary: `Incident summary ${index + 1}.`
  }));
  const svg = renderer.buildInfographicSvg({
    date: "2026-07-05",
    total_incidents: 11,
    killed: 0,
    injured: 0,
    arrested: 0,
    incidents
  }, { mapInner: "", logoDataUrl: "" });
  assert.match(svg, /Showing 10 incidents/);
  assert.match(svg, /1 additional published incident included in totals/);
  assert.doesNotMatch(svg, /Incident summary 11/);
});
