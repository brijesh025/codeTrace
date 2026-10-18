import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    GitHub({
      authorization: { params: { scope: "read:user repo" } },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ account, token }) {
      if (account?.access_token) {
        token.githubAccessToken = account.access_token;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }

      if (typeof token.githubAccessToken === "string") {
        session.accessToken = token.githubAccessToken as string;
      }

      return session;
    },
  },
});
