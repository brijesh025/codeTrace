import Link from "next/link";
import { LockKeyhole } from "lucide-react";

import type { GitHubRepository } from "../lib/github-repositories";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

export function RepositoryCard({ repository }: { repository: GitHubRepository }) {
  return (
    <Card className="repository-card">
      <CardHeader>
        <div className="repository-card-topline">
          <span className="repository-icon">{repository.name.slice(0, 1).toUpperCase()}</span>
          <Badge
            variant={repository.private ? "outline" : "secondary"}
            className={repository.private ? "visibility-pill private" : "visibility-pill"}
          >
            {repository.private ? "Private" : "Public"}
          </Badge>
        </div>
        <CardTitle>{repository.name}</CardTitle>
        <p className="repository-full-name">{repository.fullName}</p>
      </CardHeader>
      <CardContent>
        <p className="repository-description">
          {repository.description ?? "No repository description provided."}
        </p>
        <div className="repository-meta">
          <span>{repository.language ?? "Mixed language"}</span>
          <span>Updated {new Date(repository.updatedAt).toLocaleDateString("en-IN")}</span>
        </div>
        {repository.private ? (
          <Button
            className="repository-action repository-action-disabled"
            disabled
            variant="outline"
            type="button"
          >
            <LockKeyhole size={15} />
            Private analysis coming next
          </Button>
        ) : (
          <Button asChild className="repository-action" size="sm">
            <Link
              className="repository-action"
              href={`/analyze?repository=${encodeURIComponent(repository.htmlUrl)}`}
            >
              Analyze repository <span aria-hidden="true">↗</span>
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
