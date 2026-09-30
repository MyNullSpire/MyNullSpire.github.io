import { CONFIG } from './config.js';

const endpoint = () => `https://api.github.com/repos/${encodeURIComponent(CONFIG.github.owner)}/${encodeURIComponent(CONFIG.github.repo)}/issues?state=open&sort=updated&direction=desc&per_page=${CONFIG.github.limit}`;

function excerpt(markdown='') {
  return markdown.replace(/!\[[^\]]*\]\([^)]*\)/g,' ').replace(/[#>*`_[\]]/g,' ').replace(/\s+/g,' ').trim().slice(0,165);
}

function firstImage(markdown='') {
  const markdownMatch = markdown.match(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\)/i);
  if (markdownMatch) return markdownMatch[1];
  const rawMatch = markdown.match(/https?:\/\/[^\s)]+\.(?:png|jpe?g|gif|webp)(?:\?[^\s)]*)?/i);
  return rawMatch ? rawMatch[0] : '';
}

export async function fetchLessons() {
  const response = await fetch(endpoint(), { headers: { Accept:'application/vnd.github+json' } });
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
  const issues = await response.json();
  return issues.filter(issue => !issue.pull_request).map(issue => ({
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    excerpt: excerpt(issue.body || 'Open the issue for the full lesson.'),
    image: firstImage(issue.body || '') || issue.user?.avatar_url || 'assets/stories/03.png',
    labels: (issue.labels || []).slice(0,3).map(label => label.name),
    updatedAt: issue.updated_at
  }));
}

export function repoUrl() {
  return `https://github.com/${encodeURIComponent(CONFIG.github.owner)}/${encodeURIComponent(CONFIG.github.repo)}`;
}
