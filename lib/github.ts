const GH_USER = 'mukul-sharma-tech';

function ghHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': 'mukul-ai-assistant',
    'Accept': 'application/vnd.github+json',
  };
  const token = process.env.GITHUB_TOKEN;
  if (token && !token.startsWith('your_')) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function ghFetch(url: string) {
  const res = await fetch(url, { headers: ghHeaders(), next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${url}`);
  return res.json();
}

export async function getCommitHistory(projectName: string): Promise<string> {
  const searchTerm = projectName.toLowerCase().trim();

  // 1. Find matching repo
  const repos = await ghFetch(
    `https://api.github.com/users/${GH_USER}/repos?per_page=100&sort=updated`,
  );

  const matchedRepo = repos.find((r: any) =>
    r.name.toLowerCase().includes(searchTerm) ||
    (r.description && r.description.toLowerCase().includes(searchTerm)),
  );

  if (!matchedRepo) {
    return `No public repo found matching "${projectName}" on Mukul's GitHub.`;
  }

  // 2. Fetch latest 3 commits
  const commitsData = await ghFetch(
    `https://api.github.com/repos/${GH_USER}/${matchedRepo.name}/commits?per_page=3`,
  );

  if (!commitsData.length) {
    return `${matchedRepo.name} has no commit history.`;
  }

  // 3. Fetch file diffs for each commit
  const commitDetails = await Promise.all(
    commitsData.map(async (c: any) => {
      const sha     = c.sha as string;
      const message = (c.commit.message as string).split('\n')[0];
      const date    = new Date(c.commit.author.date).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      });
      const url = c.html_url as string;

      let files: { filename: string; status: string; additions: number; deletions: number }[] = [];
      try {
        const detail = await ghFetch(
          `https://api.github.com/repos/${GH_USER}/${matchedRepo.name}/commits/${sha}`,
        );
        files = (detail.files || []).slice(0, 6).map((f: any) => ({
          filename:  f.filename,
          status:    f.status,
          additions: f.additions,
          deletions: f.deletions,
        }));
      } catch { /* optional */ }

      return { sha: sha.slice(0, 7), message, date, url, files };
    }),
  );

  // 4. Build markdown
  const lines: string[] = [
    `## Recent Commits — [${matchedRepo.name}](${matchedRepo.html_url})`,
    '',
  ];

  for (const commit of commitDetails) {
    lines.push(`### [\`${commit.sha}\`](${commit.url}) · ${commit.date}`);
    lines.push(`**${commit.message}**`);
    if (commit.files.length) {
      lines.push('');
      lines.push('**Files changed:**');
      for (const f of commit.files) {
        const icon = f.status === 'added' ? '✚' : f.status === 'removed' ? '✖' : '✎';
        lines.push(`- ${icon} \`${f.filename}\` (+${f.additions} -${f.deletions})`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}
