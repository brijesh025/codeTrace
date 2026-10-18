import Link from "next/link";
import { LogIn, LogOut } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Button } from "./ui/button";
import { CodeTraceLogo } from "./codetrace-logo";

interface SiteNavProps {
  activePath?: "analyze" | "dashboard" | "home";
  isAuthenticated: boolean;
  signInAction: () => Promise<void>;
  signOutAction: () => Promise<void>;
  userImage?: string | null;
  userName?: string | null;
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function SiteNav({
  activePath = "home",
  isAuthenticated,
  signInAction,
  signOutAction,
  userImage,
  userName,
}: SiteNavProps) {
  const displayName = userName ?? "GitHub user";

  return (
    <nav className="site-nav" aria-label="Primary navigation">
      <Link className="brand-lockup" href="/" aria-label="CodeTrace home">
        <span className="brand-mark"><CodeTraceLogo /></span>
        <span className="brand-name">CodeTrace</span>
      </Link>

      <div className="nav-links">
        <Button
          asChild
          className={`nav-link ${activePath === "home" ? "nav-link-active" : ""}`}
          variant="ghost"
          size="sm"
        >
          <Link href="/">Home</Link>
        </Button>
        <Button
          asChild
          className={`nav-link ${activePath === "dashboard" ? "nav-link-active" : ""}`}
          variant="ghost"
          size="sm"
        >
          <Link href="/dashboard">Dashboard</Link>
        </Button>
      </div>

      <div className="nav-account">
        {isAuthenticated ? (
          <>
            <div className="profile-chip">
              {userImage ? (
                <Avatar className="profile-avatar">
                  <AvatarImage src={userImage} alt={`${displayName} profile`} />
                </Avatar>
              ) : (
                <Avatar className="profile-fallback">
                  <AvatarFallback>{initials(displayName)}</AvatarFallback>
                </Avatar>
              )}
              <span className="profile-name">{displayName}</span>
            </div>
            <form action={signOutAction}>
              <Button variant="outline" size="sm" type="submit">
                <LogOut size={15} /> Sign out
              </Button>
            </form>
          </>
        ) : (
          <>
            <form action={signInAction}>
              <Button variant="outline" size="sm" type="submit">
                <LogIn size={15} /> Log in
              </Button>
            </form>
            <form action={signInAction}>
              <Button size="sm" type="submit">
                Sign up <span aria-hidden="true">↗</span>
              </Button>
            </form>
          </>
        )}
      </div>
    </nav>
  );
}
