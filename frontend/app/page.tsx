import { auth, signIn, signOut } from "../auth";
import { InvestigationWorkspace } from "../components/investigation-workspace";

export default async function HomePage() {
  const session = await auth();

  async function signInWithGitHub() {
    "use server";

    await signIn("github", { redirectTo: "/" });
  }

  async function signOutOfCodeTrace() {
    "use server";

    await signOut({ redirectTo: "/" });
  }

  return (
    <main>
      {session?.user ? (
        <>
          <InvestigationWorkspace
            userLabel={session.user.name ?? session.user.email ?? session.user.id ?? "GitHub user"}
          />
          <form action={signOutOfCodeTrace} className="sign-out-form">
            <button className="text-button" type="submit">
              Sign out
            </button>
          </form>
        </>
      ) : (
        <section className="signed-out-shell">
          <div className="signed-out-card">
            <p className="eyebrow">CodeTrace</p>
            <h1>Evidence-backed codebase investigation.</h1>
            <p>
              Connect GitHub, index a public repository, and understand which code paths deserve
              attention when behavior changes.
            </p>
            <form action={signInWithGitHub}>
              <button className="primary-button" type="submit">
                Continue with GitHub
              </button>
            </form>
          </div>
        </section>
      )}
    </main>
  );
}
