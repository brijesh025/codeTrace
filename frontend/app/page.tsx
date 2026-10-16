import { auth, signIn, signOut } from "../auth";

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
    <main className="mx-auto flex min-h-screen max-w-3xl items-center px-6 py-16">
      <section className="space-y-4">
        <p className="text-sm font-medium tracking-wide text-sky-700">CodeTrace</p>
        <h1 className="text-4xl font-semibold tracking-tight text-slate-950">
          Evidence-backed codebase investigation
        </h1>
        <p className="max-w-2xl text-lg leading-8 text-slate-600">
          GitHub authentication is connected. Repository indexing and investigation workflows will
          be introduced in their planned phases.
        </p>
        {session?.user ? (
          <div className="space-y-3 pt-4">
            <p className="text-sm text-slate-700">
              Signed in as {session.user.name ?? session.user.email ?? session.user.id}.
            </p>
            <form action={signOutOfCodeTrace}>
              <button
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
                type="submit"
              >
                Sign out
              </button>
            </form>
          </div>
        ) : (
          <form action={signInWithGitHub} className="pt-4">
            <button
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
              type="submit"
            >
              Continue with GitHub
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
