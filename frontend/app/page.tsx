import { auth, signIn, signOut } from "../auth";
import { HomeLanding } from "../components/home-landing";
import { SiteNav } from "../components/site-nav";

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
      <SiteNav
        isAuthenticated={Boolean(session?.user)}
        signInAction={signInWithGitHub}
        signOutAction={signOutOfCodeTrace}
        userImage={session?.user?.image}
        userName={session?.user?.name ?? session?.user?.email ?? session?.user?.id}
      />
      <HomeLanding isAuthenticated={Boolean(session?.user)} signInAction={signInWithGitHub} />
    </main>
  );
}
