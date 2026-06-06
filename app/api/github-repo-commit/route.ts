import { NextResponse } from 'next/server';

const GH_USER = 'mukul-sharma-tech';
const GH_HEADERS: Record<string, string> = {
  'User-Agent': 'mukul-ai-assistant',
  'Accept': 'application/vnd.github+json',
};

// Only add token if it's actually set and not the placeholder
const ghToken = process.env.GITHUB_TOKEN;
if (ghToken && !ghToken.startsWith('your_')) {
  GH_HEADERS['Authorization'] = `Bearer ${ghToken}`;
}

async function ghFetch(url: string) {
  const res = await fetch(url, { headers: GH_HEADERS, next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${url}`);
  return res.json();
}

export async function POST(request: Request) {
  try {
    const { project } = await request.json();

    if (!project) {
      return NextResponse.json({ message: 'Please provide a project name.' }, { status: 400 });
    }

    const searchTerm = project.toLowerCase().trim();

    // 1. Find matching repo
    const repos = await ghFetch(
      `https://api.github.com/users/${GH_USER}/repos?per_page=100&sort=updated`,
    );

    const matchedRepo = repos.find((r: any) =>
      r.name.toLowerCase().includes(searchTerm) ||
      (r.description && r.description.toLowerCase().includes(searchTerm)),
    );

    if (!matchedRepo) {
      return NextResponse.json({
        message: `No public repo found matching "${project}" on Mukul's GitHub.`,
      });
    }

    // 2. Fetch latest 3 commits
    const commitsData = await ghFetch(
      `https://api.github.com/repos/${GH_USER}/${matchedRepo.name}/commits?per_page=3`,
    );

    if (!commitsData.length) {
      return NextResponse.json({ message: `${matchedRepo.name} has no commit history.` });
    }

    // 3. For each commit, fetch the diff to see what files changed
    const commitDetails = await Promise.all(
      commitsData.map(async (c: any) => {
        const sha     = c.sha as string;
        const message = c.commit.message as string;
        const date    = new Date(c.commit.author.date).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric',
        });
        const author  = c.commit.author.name as string;
        const url     = c.html_url as string;

        // Fetch individual commit to get file changes
        let files: { filename: string; status: string; additions: number; deletions: number }[] = [];
        try {
          const detail = await ghFetch(
            `https://api.github.com/repos/${GH_USER}/${matchedRepo.name}/commits/${sha}`,
          );
          files = (detail.files || []).slice(0, 6).map((f: any) => ({
            filename:  f.filename,
            status:    f.status,       // added | modified | removed | renamed
            additions: f.additions,
            deletions: f.deletions,
          }));
        } catch {
          // ignore — commit detail optional
        }

        return { sha: sha.slice(0, 7), message, date, author, url, files };
      }),
    );

    // 4. Build a rich markdown response
    const lines: string[] = [
      `## Recent Commits — [${matchedRepo.name}](${matchedRepo.html_url})`,
      '',
    ];

    for (const commit of commitDetails) {
      lines.push(`### [\`${commit.sha}\`](${commit.url}) · ${commit.date}`);
      lines.push(`**${commit.message.split('\n')[0]}**`);

      if (commit.files.length) {
        lines.push('');
        lines.push('**Files changed:**');
        for (const f of commit.files) {
          const statusIcon = f.status === 'added' ? '✚' : f.status === 'removed' ? '✖' : '✎';
          lines.push(`- ${statusIcon} \`${f.filename}\` (+${f.additions} -${f.deletions})`);
        }
      }
      lines.push('');
    }

    return NextResponse.json({ result: lines.join('\n') });

  } catch (error: any) {
    console.error('GitHub commit API error:', error.message);
    return NextResponse.json({
      message: "Couldn't connect to GitHub's API right now. Try again shortly.",
    });
  }
}
