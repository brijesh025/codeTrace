import "next-auth";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    user: {
      id: string;
    } & Session["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    githubAccessToken?: string;
  }
}
