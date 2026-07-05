import assert from "node:assert/strict";
import { test } from "node:test";

await import("../../static/admin-infographic.js");

const renderer = globalThis.TGDInfographic;

test("infographic groups incidents from the same location into one numbered card", () => {
  const groups = renderer.groupIncidents([
    {
      district: "Bannu",
      locality: "Mandio",
      province: "Khyber Pakhtunkhwa",
      latitude: 32.99,
      longitude: 70.6,
      category: "Armed attack",
      summary: "First incident."
    },
    {
      district: "Bannu",
      locality: "Mandio",
      province: "Khyber Pakhtunkhwa",
      latitude: 32.99,
      longitude: 70.6,
      category: "IED / Explosion",
      summary: "Second incident."
    }
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].incidents.length, 2);
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
