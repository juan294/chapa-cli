import type { StatsData, RawContributionData } from "./shared.js";
import { CONTRIBUTION_QUERY, buildStatsFromRaw, SCORING_WINDOW_DAYS } from "./shared.js";
import type { Logger } from "./logger.js";

// ---------------------------------------------------------------------------
// GraphQL response types
// ---------------------------------------------------------------------------

/** Shape of a single owned-repo node returned by the GraphQL query. */
interface OwnedRepoNode {
  stargazerCount: number;
  forkCount: number;
  watchers: { totalCount: number };
}

/** Full shape of the GitHub GraphQL response for the contribution query. */
interface GraphQLResponse {
  data?: {
    user: {
      login: string;
      name: string | null;
      avatarUrl: string;
      contributionsCollection: {
        contributionCalendar: {
          totalContributions: number;
          weeks: {
            contributionDays: {
              date: string;
              contributionCount: number;
            }[];
          }[];
        };
        pullRequestContributions: {
          totalCount: number;
          nodes: ({
            pullRequest: {
              additions: number;
              deletions: number;
              changedFiles: number;
              merged: boolean;
            } | null;
          } | null)[];
        };
        pullRequestReviewContributions: { totalCount: number };
        issueContributions: { totalCount: number };
      };
      repositories: {
        totalCount: number;
        nodes: {
          nameWithOwner: string;
          defaultBranchRef: {
            target: { history: { totalCount: number } };
          } | null;
        }[];
      };
      ownedRepos?: {
        nodes: (OwnedRepoNode | null)[];
      };
    } | null;
  };
  errors?: { message: string; type?: string }[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Maximum characters to log from error response bodies or GraphQL errors. */
const MAX_ERROR_BODY_LENGTH = 200;

/** Truncate a string to the given max length, appending "..." if truncated. */
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

/** Extract a useful error message, walking error.cause chain for root cause. */
function extractErrorDetail(err: Error): string {
  const parts = [err.message];
  let current: unknown = err.cause;
  while (current instanceof Error) {
    if (current.message && current.message !== err.message) {
      parts.push(current.message);
    }
    current = current.cause;
  }
  return parts.join(" → ");
}

// ---------------------------------------------------------------------------
// Fetch EMU stats via GraphQL (requires EMU token with auth)
// ---------------------------------------------------------------------------

export interface FetchEmuOptions {
  logger?: Logger;
}

export async function fetchEmuStats(
  login: string,
  emuToken: string,
  opts?: FetchEmuOptions,
): Promise<StatsData | null> {
  const log = opts?.logger;
  const now = new Date();
  const since = new Date(now);
  since.setDate(since.getDate() - SCORING_WINDOW_DAYS);

  log?.debug(`Scoring window: ${since.toISOString()} → ${now.toISOString()}`);

  try {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${emuToken}`,
      },
      body: JSON.stringify({
        query: CONTRIBUTION_QUERY,
        variables: {
          login,
          since: since.toISOString(),
          until: now.toISOString(),
          historySince: since.toISOString(),
          historyUntil: now.toISOString(),
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "(unreadable)");
      const msg = `[cli] GraphQL HTTP ${res.status}: ${truncate(body, MAX_ERROR_BODY_LENGTH)}`;
      if (log) { log.error(msg); } else { console.error(msg); }
      return null;
    }

    const json: GraphQLResponse = await res.json();

    if (json.errors) {
      const errStr = truncate(JSON.stringify(json.errors), MAX_ERROR_BODY_LENGTH);
      const msg = `[cli] GraphQL errors for ${login}: ${errStr}`;
      if (log) { log.error(msg); } else { console.error(msg); }
    }

    if (!json.data?.user) return null;

    const user = json.data.user;
    const cc = user.contributionsCollection;

    // Normalize raw GraphQL response into RawContributionData shape.
    // The GraphQL response wraps PRs as { pullRequest: { ... } } and may
    // contain null nodes — filter and unwrap them here.
    const prNodes = cc.pullRequestContributions.nodes
      .filter(
        (n): n is { pullRequest: { additions: number; deletions: number; changedFiles: number; merged: boolean } } =>
          n != null && n.pullRequest != null,
      )
      .map((n) => n.pullRequest);

    const raw: RawContributionData = {
      login: user.login,
      name: user.name,
      avatarUrl: user.avatarUrl,
      contributionCalendar: cc.contributionCalendar,
      pullRequests: {
        totalCount: cc.pullRequestContributions.totalCount,
        nodes: prNodes,
      },
      reviews: { totalCount: cc.pullRequestReviewContributions.totalCount },
      issues: { totalCount: cc.issueContributions.totalCount },
      repositories: {
        totalCount: user.repositories.totalCount,
        nodes: user.repositories.nodes,
      },
      ownedRepoStars: {
        nodes: (user.ownedRepos?.nodes ?? [])
          .filter((n: OwnedRepoNode | null): n is OwnedRepoNode => n != null)
          .map((n) => ({ stargazerCount: n.stargazerCount, forkCount: n.forkCount, watchers: { totalCount: n.watchers.totalCount } })),
      },
    };

    return buildStatsFromRaw(raw);
  } catch (err) {
    const detail = extractErrorDetail(err as Error);
    const msg = `[cli] fetch error: ${detail}`;
    if (log) { log.error(msg); } else { console.error(msg); }
    return null;
  }
}
