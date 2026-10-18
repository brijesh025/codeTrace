import { auth, signIn, signOut } from "../../auth";
import { RepositoryCard } from "../../components/repository-card";
import { SiteNav } from "../../components/site-nav";
import { Button } from "../../components/ui/button";
import { getGitHubRepositories } from "../../lib/github-repositories";

export default async function DashboardPage() {
  const session = await auth();

  async function signInWithGitHub() {
    "use server";
    await signIn("github", { redirectTo: "/dashboard" });
  }

  async function signOutOfCodeTrace() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  if (!session?.user) {
    return (
      <main>
        <SiteNav
          isAuthenticated={false}
          signInAction={signInWithGitHub}
          signOutAction={signOutOfCodeTrace}
        />
        <section className="login-gate-shell">
          <div className="login-gate-card">
            <p className="eyebrow">Dashboard access</p>
            <h1>Sign in to see your repositories.</h1>
            <p>Connect GitHub to browse your repositories and choose one to analyze.</p>
            <form action={signInWithGitHub}>
              <Button size="lg" type="submit">
                Continue with GitHub <span aria-hidden="true">↗</span>
              </Button>
            </form>
          </div>
        </section>
      </main>
    );
  }

  let repositories = null;
  let repositoryError: string | null = null;
  if (session.accessToken) {
    try {
      repositories = await getGitHubRepositories(session.accessToken);
    } catch (error) {
      repositoryError = error instanceof Error ? error.message : "Could not load repositories.";
    }
  } else {
    repositoryError = "Reconnect GitHub to load your repositories.";
  }

  return (
    <main>
      <SiteNav
        activePath="dashboard"
        isAuthenticated
        signInAction={signInWithGitHub}
        signOutAction={signOutOfCodeTrace}
        userImage={session.user.image}
        userName={session.user.name ?? session.user.email ?? session.user.id}
      />
      <section className="dashboard-shell">
        <div className="dashboard-heading">
          <div>
            <p className="eyebrow">Your workspace</p>
            <h1>Choose a repository to trace.</h1>
            <p>
              Your GitHub repositories are ready to become evidence graphs. Start with a public
              repository and ask a focused impact question.
            </p>
          </div>
          <div className="dashboard-count">
            <strong>{repositories?.length ?? 0}</strong>
            <span className="dashboard-count-label">repositories</span>
          </div>
        </div>

        {repositoryError ? <div className="alert alert-error">{repositoryError}</div> : null}
        {repositories?.length === 0 ? (
          <div className="empty-state dashboard-empty">
            No repositories were returned from GitHub.
          </div>
        ) : (
          <div className="repository-grid">
            {repositories?.map((repository) => (
              <RepositoryCard key={repository.id} repository={repository} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
