import { readFile, writeFile } from "node:fs/promises";

const owner = process.env.GITHUB_REPOSITORY_OWNER;
const token = process.env.GITHUB_TOKEN;

if (!owner || !token) {
  throw new Error("GITHUB_REPOSITORY_OWNER and GITHUB_TOKEN are required");
}

const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "User-Agent": "profile-language-stats",
};

async function getJson(path) {
  const response = await fetch(`https://api.github.com${path}`, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${path}`);
  }
  return response.json();
}

async function listRepositories() {
  const repositories = [];
  for (let page = 1; ; page += 1) {
    const batch = await getJson(
      `/users/${encodeURIComponent(owner)}/repos?type=owner&sort=full_name&per_page=100&page=${page}`,
    );
    repositories.push(...batch);
    if (batch.length < 100) return repositories;
  }
}

function renderBar(percentage) {
  const filled = Math.round(percentage / 5);
  return `${"█".repeat(filled)}${"░".repeat(20 - filled)}`;
}

const repositories = (await listRepositories()).filter(
  (repository) => !repository.fork && !repository.archived && !repository.disabled,
);

const languageMaps = [];
for (let index = 0; index < repositories.length; index += 10) {
  const batch = repositories.slice(index, index + 10);
  languageMaps.push(
    ...(await Promise.all(
      batch.map((repository) =>
        getJson(`/repos/${repository.full_name}/languages`),
      ),
    )),
  );
}

const totals = new Map();
for (const languages of languageMaps) {
  for (const [language, bytes] of Object.entries(languages)) {
    totals.set(language, (totals.get(language) ?? 0) + bytes);
  }
}

const totalBytes = [...totals.values()].reduce((sum, bytes) => sum + bytes, 0);
if (totalBytes === 0) throw new Error("No language data found");

const rows = [...totals.entries()]
  .sort((left, right) => right[1] - left[1])
  .slice(0, 5)
  .map(([language, bytes]) => {
    const percentage = (bytes / totalBytes) * 100;
    return `${language.padEnd(25)} ${renderBar(percentage)} ${percentage
      .toFixed(2)
      .padStart(6)}%`;
  });

const startMarker = "<!--START_SECTION:languages-->";
const endMarker = "<!--END_SECTION:languages-->";
const readme = await readFile("README.md", "utf8");
const start = readme.indexOf(startMarker);
const end = readme.indexOf(endMarker);

if (start === -1 || end === -1 || start >= end) {
  throw new Error("Language section markers are missing or invalid");
}

const section = `${startMarker}\n\`\`\`text\n${rows.join("\n")}\n\`\`\`\n`;
const updated = `${readme.slice(0, start)}${section}${readme.slice(end)}`;
await writeFile("README.md", updated);

console.log(`Updated language stats from ${repositories.length} repositories.`);
