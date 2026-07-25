import { WORK_DIR } from '~/utils/constants';
import type { FileMap } from '~/lib/stores/files';

const GITHUB_API = 'https://api.github.com';
const TOKEN_STORAGE_KEY = 'jayc_github_token';

export interface GitHubExportOptions {
  token: string;
  repoName: string;
  isPrivate: boolean;
  files: FileMap;
}

export interface GitHubExportResult {
  repoUrl: string;
  owner: string;
  repo: string;
  fileCount: number;
  skippedBinary: string[];
  updatedExisting: boolean;
}

export function getSavedToken(): string {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveToken(token: string) {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // localStorage unavailable — token simply won't persist
  }
}

export function sanitizeRepoName(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);

  return cleaned || 'jayc-project';
}

class GitHubApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function githubFetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let message = `GitHub API error (${response.status})`;

    try {
      const body = (await response.json()) as { message?: string };

      if (body.message) {
        message = body.message;
      }
    } catch {
      // keep the generic message
    }

    throw new GitHubApiError(response.status, message);
  }

  return (await response.json()) as T;
}

interface GitHubUser {
  login: string;
}

interface GitHubRepo {
  html_url: string;
  default_branch: string;
}

interface GitHubRef {
  object: { sha: string };
}

interface GitHubCommit {
  sha: string;
  tree: { sha: string };
}

interface GitHubTree {
  sha: string;
}

interface TreeEntry {
  path: string;
  mode: '100644';
  type: 'blob';
  content: string;
}

/**
 * Converts the workbench FileMap into GitHub git-tree entries.
 * Text files are inlined; binary files are skipped and reported.
 */
function buildTreeEntries(files: FileMap): { entries: TreeEntry[]; skippedBinary: string[] } {
  const entries: TreeEntry[] = [];
  const skippedBinary: string[] = [];

  for (const [absolutePath, dirent] of Object.entries(files)) {
    if (dirent?.type !== 'file') {
      continue;
    }

    const repoPath = absolutePath.startsWith(WORK_DIR) ? absolutePath.slice(WORK_DIR.length + 1) : absolutePath;

    if (!repoPath) {
      continue;
    }

    if (dirent.isBinary) {
      skippedBinary.push(repoPath);
      continue;
    }

    entries.push({ path: repoPath, mode: '100644', type: 'blob', content: dirent.content });
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));

  return { entries, skippedBinary };
}

/**
 * Exports every file in the workbench to a GitHub repository.
 *
 * Creates the repo when it doesn't exist yet; otherwise pushes a new commit
 * on top of the existing default branch. Files present in the repo but absent
 * from the workbench are left untouched when updating.
 */
export async function exportProjectToGitHub(options: GitHubExportOptions): Promise<GitHubExportResult> {
  const { token, repoName, isPrivate, files } = options;
  const repo = sanitizeRepoName(repoName);

  const { entries, skippedBinary } = buildTreeEntries(files);

  if (entries.length === 0) {
    throw new Error('There are no exportable text files in this project yet.');
  }

  // 1. who is exporting?
  const user = await githubFetch<GitHubUser>(token, '/user');
  const owner = user.login;

  /** 2. Create the repo with an initial commit, or fall back to updating an existing one on name clash */
  let updatedExisting = false;

  try {
    await githubFetch<GitHubRepo>(token, '/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name: repo,
        private: isPrivate,
        description: 'Built with Jayc',
        auto_init: true,
      }),
    });
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 422) {
      // repo name already exists on this account — update it instead
      updatedExisting = true;
    } else {
      throw error;
    }
  }

  // 3. find the default branch and its latest commit
  const repoInfo = await githubFetch<GitHubRepo>(token, `/repos/${owner}/${repo}`);
  const branch = repoInfo.default_branch || 'main';
  const repoUrl = repoInfo.html_url;

  let parentCommitSha: string | undefined;
  let baseTreeSha: string | undefined;

  const readHeadCommit = async () => {
    const ref = await githubFetch<GitHubRef>(token, `/repos/${owner}/${repo}/git/ref/heads/${branch}`);
    const commit = await githubFetch<GitHubCommit>(token, `/repos/${owner}/${repo}/git/commits/${ref.object.sha}`);
    parentCommitSha = commit.sha;
    baseTreeSha = commit.tree.sha;
  };

  try {
    await readHeadCommit();
  } catch (error) {
    if (error instanceof GitHubApiError && (error.status === 404 || error.status === 409)) {
      // repo exists but has zero commits (404/409) — seed a readme via the contents api, which works on empty repos
      await githubFetch(token, `/repos/${owner}/${repo}/contents/README.md`, {
        method: 'PUT',
        body: JSON.stringify({
          message: 'Initial commit',
          content: btoa(`# ${repo}\n\nBuilt with Jayc\n`),
        }),
      });
      await readHeadCommit();
    } else {
      throw error;
    }
  }

  /** 4. Create the tree, layered on the existing tree so unrelated repo files are preserved */
  const tree = await githubFetch<GitHubTree>(token, `/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: entries,
    }),
  });

  // 5. create the commit
  const commit = await githubFetch<GitHubCommit>(token, `/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: updatedExisting ? 'Update from Jayc' : 'Initial commit from Jayc',
      tree: tree.sha,
      parents: parentCommitSha ? [parentCommitSha] : [],
    }),
  });

  // 6. point the branch at the new commit
  if (parentCommitSha) {
    await githubFetch<GitHubRef>(token, `/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha }),
    });
  } else {
    await githubFetch<GitHubRef>(token, `/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
    });
  }

  return {
    repoUrl,
    owner,
    repo,
    fileCount: entries.length,
    skippedBinary,
    updatedExisting,
  };
}
