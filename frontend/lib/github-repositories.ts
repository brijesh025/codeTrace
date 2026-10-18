export interface GitHubRepository {
  defaultBranch: string;
  description: string | null;
  htmlUrl: string;
  id: number;
  isFork: boolean;
  language: string | null;
  name: string;
  fullName: string;
  private: boolean;
  updatedAt: string;
}

interface GitHubRepositoryResponse {
  default_branch: string;
  description: string | null;
  fork: boolean;
  html_url: string;
  id: number;
  language: string | null;
  name: string;
  full_name: string;
  private: boolean;
  updated_at: string;
}

export async function getGitHubRepositories(accessToken: string): Promise<GitHubRepository[]> {
  const response = await fetch(
    "https://api.github.com/user/repos?sort=updated&direction=desc&per_page=100&affiliation=owner,collaborator,organization_member",
    {
      cache: "no-store",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${accessToken}`,
        "x-github-api-version": "2022-11-28",
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? "GitHub authorization expired. Sign out and sign in again."
        : "GitHub repositories could not be loaded.",
    );
  }

  const repositories = (await response.json()) as GitHubRepositoryResponse[];
  return repositories.map((repository) => ({
    defaultBranch: repository.default_branch,
    description: repository.description,
    fullName: repository.full_name,
    htmlUrl: repository.html_url,
    id: repository.id,
    isFork: repository.fork,
    language: repository.language,
    name: repository.name,
    private: repository.private,
    updatedAt: repository.updated_at,
  }));
}
