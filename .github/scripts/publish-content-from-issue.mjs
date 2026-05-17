import fs from "fs";
import path from "path";

const TYPE_MAP = {
  monthlyreport: {
    folder: "reports",
    type: "reports",
    category: "Monthly",
    author: "TGD Research Desk"
  },
  dailyarticle: {
    folder: "news",
    type: "news",
    category: "Daily Briefing",
    author: "TGD News Desk"
  },
  dailyincidentlog: {
    folder: "monitoring",
    type: "monitoring",
    category: "Daily Incident Log",
    author: "TGD Monitoring Desk"
  },
  opinion: {
    folder: "opinion",
    type: "opinion",
    category: "Opinion",
    author: "TGD Opinion Desk"
  },
  profile: {
    folder: "profiles",
    type: "profiles",
    category: "Individual",
    author: "TGD Research Desk"
  }
};

function normalize(input = "") {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function clean(input = "") {
  const value = input.trim();
  return value === "_No response_" ? "" : value;
}

function firstLine(input = "") {
  return clean(input).split("\n").map((line) => line.trim()).find(Boolean) || "";
}

function parseIssueForm(markdown = "") {
  const fields = new Map();
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let label = "";
  let buffer = [];

  const flush = () => {
    if (!label) return;
    fields.set(normalize(label), clean(buffer.join("\n")));
  };

  for (const line of lines) {
    const heading = line.match(/^###\s+(.+?)\s*$/);
    if (heading) {
      flush();
      label = heading[1];
      buffer = [];
    } else if (label) {
      buffer.push(line);
    }
  }

  flush();
  return fields;
}

function yamlString(value = "") {
  return JSON.stringify(String(value));
}

function yamlArray(values = []) {
  return `[${values.map(yamlString).join(", ")}]`;
}

function slugify(input = "") {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function uniquePath(folder, date, title) {
  const dir = path.join("content", folder);
  fs.mkdirSync(dir, { recursive: true });

  const base = `${date}-${slugify(title) || "untitled"}`;
  let candidate = path.join(dir, `${base}.md`);
  let index = 2;

  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base}-${index}.md`);
    index += 1;
  }

  return candidate;
}

function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function requireField(fields, label) {
  const value = clean(fields.get(normalize(label)) || "");
  if (!value) throw new Error(`Missing required field: ${label}`);
  return value;
}

function main() {
  if (!process.env.GITHUB_EVENT_PATH) {
    throw new Error("GITHUB_EVENT_PATH is missing.");
  }

  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const issue = event.issue;
  if (!issue) throw new Error("This workflow needs a GitHub issue form event.");

  const fields = parseIssueForm(issue.body || "");
  const typeLabel = firstLine(requireField(fields, "Content type"));
  const typeConfig = TYPE_MAP[normalize(typeLabel)];
  if (!typeConfig) throw new Error(`Unsupported content type: ${typeLabel}`);

  const title = firstLine(requireField(fields, "Title"));
  const date = firstLine(requireField(fields, "Date"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Date must use YYYY-MM-DD format, for example 2026-05-31.");
  }

  const region = firstLine(requireField(fields, "Region"));
  const summary = requireField(fields, "Short summary").replace(/\n+/g, " ");
  const body = requireField(fields, "Article body");
  const category = firstLine(fields.get(normalize("Category")) || "") || typeConfig.category;
  const author = firstLine(fields.get(normalize("Author or desk")) || "") || typeConfig.author;
  const sensitivity = firstLine(fields.get(normalize("Sensitivity")) || "") || "standard";
  const featured = firstLine(fields.get(normalize("Feature on homepage?")) || "").toLowerCase() === "yes";
  const pdfLink = firstLine(fields.get(normalize("PDF link")) || "");
  const tags = clean(fields.get(normalize("Tags")) || "")
    .split(/[,;\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean);

  const articleBody = [
    body.trim(),
    pdfLink ? `[Download related PDF](${pdfLink})` : ""
  ].filter(Boolean).join("\n\n");

  const content = [
    "---",
    `title: ${yamlString(title)}`,
    `date: ${yamlString(date)}`,
    `author: ${yamlString(author)}`,
    `type: ${yamlString(typeConfig.type)}`,
    `category: ${yamlString(category)}`,
    `region: ${yamlString(region)}`,
    `summary: ${yamlString(summary)}`,
    `tags: ${yamlArray(tags)}`,
    `access: "free"`,
    `sensitivity: ${yamlString(sensitivity)}`,
    `featured: ${featured}`,
    "---",
    "",
    articleBody,
    ""
  ].join("\n");

  const contentPath = uniquePath(typeConfig.folder, date, title);
  fs.writeFileSync(contentPath, content, "utf8");

  writeOutput("content_path", contentPath);
  writeOutput("content_title", title.replace(/\n/g, " "));
  console.log(`Created ${contentPath}`);
}

try {
  main();
} catch (error) {
  console.error(`::error::${error.message}`);
  process.exit(1);
}
