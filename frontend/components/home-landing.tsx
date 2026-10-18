import Link from "next/link";
import { FileSearch, GitBranch, Network } from "lucide-react";

import { HomeArchitecture } from "./home-architecture";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

interface HomeLandingProps {
  isAuthenticated: boolean;
  signInAction: () => Promise<void>;
}

export function HomeLanding({ isAuthenticated, signInAction }: HomeLandingProps) {
  return (
    <>
      <section className="home-hero">
        <div className="hero-orbit hero-orbit-left" />
        <div className="hero-orbit hero-orbit-right" />
        <div className="home-hero-content">
          <Badge variant="secondary" className="hero-kicker">
            <span className="hero-kicker-dot" />
            GitHub-native code intelligence
          </Badge>
          <h1>See what breaks before you ship.</h1>
          <p>
            CodeTrace turns your repository into an evidence graph, then helps you trace the real
            impact of a change across files, functions, and relationships.
          </p>
          <div className="hero-actions">
            {isAuthenticated ? (
              <Button asChild size="lg">
                <Link href="/dashboard">
                  Open your dashboard <span aria-hidden="true">↗</span>
                </Link>
              </Button>
            ) : (
              <form action={signInAction}>
                <Button size="lg" type="submit">
                  Start with GitHub <span aria-hidden="true">↗</span>
                </Button>
              </form>
            )}
            <span className="hero-note">Public repositories · no code execution</span>
          </div>
          <div className="hero-proof-row">
            <span>01 / Index</span>
            <span>02 / Trace</span>
            <span>03 / Act</span>
          </div>
        </div>
      </section>

      <section className="home-details" aria-labelledby="how-it-works">
        <div className="home-section-heading">
          <p className="eyebrow">How it works</p>
          <h2 id="how-it-works">From repository to reasoned action.</h2>
          <p>
            Every answer begins with structure we can inspect, not a guess from a language model.
          </p>
        </div>
        <div className="home-step-grid">
          <Card className="home-step-card">
            <CardHeader>
              <span className="home-step-number">01</span>
              <CardTitle>Index the codebase</CardTitle>
            </CardHeader>
            <CardContent>
              <p>
                Clone a public GitHub repository and map its files, symbols, imports, and calls.
              </p>
            </CardContent>
          </Card>
          <Card className="home-step-card">
            <CardHeader>
              <span className="home-step-number">02</span>
              <CardTitle>Ask an impact question</CardTitle>
            </CardHeader>
            <CardContent>
              <p>
                Describe the behavior or module you are changing and let the agent query the graph.
              </p>
            </CardContent>
          </Card>
          <Card className="home-step-card">
            <CardHeader>
              <span className="home-step-number">03</span>
              <CardTitle>Follow the evidence</CardTitle>
            </CardHeader>
            <CardContent>
              <p>
                Review ranked findings, relationship paths, source locations, and a practical
                checklist.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      <HomeArchitecture />

      <section className="home-proof-grid" aria-label="CodeTrace principles">
        <div>
          <span className="home-proof-label">
            <Network size={16} /> Graph first
          </span>
          <p>Relationships are retrieved from FalkorDB before the model explains them.</p>
        </div>
        <div>
          <span className="home-proof-label">
            <FileSearch size={16} /> Evidence bound
          </span>
          <p>Unsupported findings are rejected or called out as uncertainty.</p>
        </div>
        <div>
          <span className="home-proof-label">
            <GitBranch size={16} /> Built for change
          </span>
          <p>Ask where a broken or changed behavior could travel through the codebase.</p>
        </div>
      </section>
    </>
  );
}
