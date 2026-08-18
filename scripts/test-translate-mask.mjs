// Masking guard: if this fails, translated articles can lose images or links.
import { __maskingInternals } from "../worker/src/translate.js";

const { maskText, unmaskText, chunkBlocks } = __maskingInternals;
const API = process.env.CONTENT_API || "https://theglobaldecipher.com/api";
const collections = ["news", "opinion", "reports", "pages"];

let checked = 0;
let failures = 0;

function check(label, source) {
  const { text, tokens } = maskText(source);
  const restored = unmaskText(text, tokens);
  checked += 1;
  if (restored !== source) {
    failures += 1;
    const at = [...source].findIndex((ch, i) => restored[i] !== ch);
    console.error(`FAIL ${label}: round trip differs at offset ${at}`);
    console.error(`  original : ${JSON.stringify(source.slice(Math.max(0, at - 60), at + 60))}`);
    console.error(`  restored : ${JSON.stringify(restored.slice(Math.max(0, at - 60), at + 60))}`);
    return;
  }
  const prose = text.replace(/@@T\d+@@/g, "").trim();
  const chunks = chunkBlocks(text);
  console.log(`ok   ${label} — ${source.length}B source, ${prose.length}B prose, ${tokens.length} masked, ${chunks.length} chunk(s)`);
}

check("synthetic/nested", `Intro with a [link](https://example.com/a?b=1).

## ![](data:image/png;base64,AAAABBBBCCCC=)

<div class="tracker">Visible text inside a div</div>

- item with \`code\` and TTP
- item with https://x.com/Global_Decipher

| Date | Killed |
| --- | --- |
| 2026-08-02 | 14 |`);

for (const collection of collections) {
  const res = await fetch(`${API}/content/dump?folder=${collection}`);
  const { items = [] } = await res.json();
  for (const item of items) check(`${collection}/${item.slug}`, item.body || "");
}

console.log(`\n${checked - failures}/${checked} bodies round-tripped cleanly.`);
process.exit(failures ? 1 : 0);
