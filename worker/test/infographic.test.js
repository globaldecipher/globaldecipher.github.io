import assert from "node:assert/strict";
import { test } from "node:test";

await import("../../static/admin-infographic.js");

const renderer = globalThis.TGDInfographic;

test("infographic groups incidents from the same district into one numbered A/B card", () => {
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
  const svg = renderer.buildInfographicSvg({
    date: "2026-07-05",
    total_incidents: 2,
    killed: 0,
    injured: 2,
    arrested: 0,
    incidents: groups[0].incidents
  }, { mapInner: "", logoDataUrl: "" });
  assert.match(svg, /A\) SHAKAR DARA, MATTA, SWAT/);
  assert.match(svg, /B\) MATTA, SWAT/);
  assert.doesNotMatch(svg, /\(2\) SWAT/);
});

test("infographic numbering and card placement follow geography", () => {
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
  assert.deepEqual(groups.map((group) => group.district), [
    "Swat",
    "Lower South Waziristan",
    "Kech"
  ]);
  const cards = renderer.layoutGroups(groups);
  assert.equal(cards.find((card) => card.group.district === "Swat").side, "right");
  assert.equal(cards.find((card) => card.group.district === "Kech").side, "left");
  assert.ok(
    cards.find((card) => card.group.district === "Swat").marker.y
      < cards.find((card) => card.group.district === "Kech").marker.y
  );
  assert.deepEqual(
    renderer.headingLinesFor(groups[1], "KP"),
    ["(2) LOWER SOUTH", "WAZIRISTAN — KP"]
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
  assert.match(svg, /Incidents: 2/);
  assert.match(svg, /theglobaldecipher\.com/);
  assert.match(svg, /\.province \{ fill: #dedfdb !important; stroke: #65717a !important;/);
  assert.match(svg, /clipPath id="card-clip-1"/);
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
