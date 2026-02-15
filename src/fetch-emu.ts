import type { StatsData, RawContributionData } from "./shared.js";
import { CONTRIBUTION_QUERY, buildStatsFromRaw, SCORING_WINDOW_DAYS } from "./shared.js";

// ---------------------------------------------------------------------------
// Fetch EMU stats via GraphQL (requires EMU token with auth)
// ---------------------------------------------------------------------------

export async function fetchEmuStats(
  login: string,
  emuToken: string,
): Promise<StatsData | null> {
  const now = new Date();
  const since = new Date(now);
  since.setDate(since.getDate() - SCORING_WINDOW_DAYS);

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
      console.error(`[cli] GraphQL HTTP ${res.status}: ${body}`);
      return null;
    }

    const json = await res.json();

    if (json.errors) {
      console.error(`[cli] GraphQL errors for ${login}:`, json.errors);
    }

    if (!json.data?.user) return null;

    const user = json.data.user;
    const cc = user.contributionsCollection;

    // Normalize raw GraphQL response into RawContributionData shape.
    // The GraphQL response wraps PRs as { pullRequest: { ... } } and may
    // contain null nodes — filter and unwrap them here.
    const prNodes = cc.pullRequestContributions.nodes
      .filter(
        (n: { pullRequest: unknown } | null) =>
          n != null && n.pullRequest != null,
      )
      .map(
        (n: {
          pullRequest: {
            additions: number;
            deletions: number;
            changedFiles: number;
            merged: boolean;
          };
        }) => n.pullRequest,
      );

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
          .filter((n: any) => n != null)
          .map((n: any) => ({ stargazerCount: n.stargazerCount, forkCount: n.forkCount, watchers: { totalCount: n.watchers.totalCount } })),
      },
    };

    return buildStatsFromRaw(raw);
  } catch (err) {
    console.error(`[cli] fetch error:`, err);
    return null;
  }
}
