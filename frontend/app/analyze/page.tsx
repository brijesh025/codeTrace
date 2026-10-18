import { redirect } from "next/navigation";

import { auth, signIn, signOut } from "../../auth";
import { InvestigationWorkspace } from "../../components/investigation-workspace";
import { SiteNav } from "../../components/site-nav";

export default async function AnalyzePage({
  searchParams,
}: {
  searchParams?: Promise<{ repository?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const repository = Array.isArray(params?.repository) ? params.repository[0] : params?.repository;

  async function signInWithGitHub() {
    "use server";
    await signIn("github", { redirectTo: "/analyze" });
  }

  async function signOutOfCodeTrace() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <main>
      <SiteNav
        activePath="analyze"
        isAuthenticated
        signInAction={signInWithGitHub}
        signOutAction={signOutOfCodeTrace}
        userImage={session.user.image}
        userName={session.user.name ?? session.user.email ?? session.user.id}
      />
      <InvestigationWorkspace initialRepositoryUrl={repository} />
    </main>
  );
}
