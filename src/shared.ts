/**
 * Inlined from @chapa/shared — types, constants, query, and stats aggregation.
 *
 * These are the pieces of the Chapa shared package that the CLI needs.
 * Inlined here so the CLI repo is fully independent.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of days of GitHub activity used for scoring. */
export const SCORING_WINDOW_DAYS = 365;

/** Cap for aggregated PR weight (used by buildStatsFromRaw). */
export const PR_WEIGHT_AGG_CAP = 120;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Daily activity count for heatmap */
export interface HeatmapDay {
  date: string; // ISO date string (YYYY-MM-DD)
  count: number;
}

/** Aggregated GitHub stats over the last 365 days */
export interface StatsData {
  handle: string;
  displayName?: string;
  avatarUrl?: string;
  commitsTotal: number;
  activeDays: number;
  prsMergedCount: number;
  prsMergedWeight: number;
  reviewsSubmittedCount: number;
  issuesClosedCount: number;
  linesAdded: number;
  linesDeleted: number;
  reposContributed: number;
  topRepoShare: number;
  maxCommitsIn10Min: number;
  microCommitRatio?: number;
  docsOnlyPrRatio?: number;
  totalStars: number;
  totalForks: number;
  totalWatchers: number;
  heatmapData: HeatmapDay[];
  fetchedAt: string;
  hasSupplementalData?: boolean;
}

/** Raw data shape returned by the GitHub GraphQL contribution query */
export interface RawContributionData {
  login: string;
  name: string | null;
  avatarUrl: string;
  contributionCalendar: {
    totalContributions: number;
    weeks: {
      contributionDays: {
        date: string;
        contributionCount: number;
      }[];
    }[];
  };
  pullRequests: {
    totalCount: number;
    nodes: {
      additions: number;
      deletions: number;
      changedFiles: number;
      merged: boolean;
    }[];
  };
  reviews: { totalCount: number };
  issues: { totalCount: number };
  repositories: {
    totalCount: number;
    nodes: {
      nameWithOwner: string;
      defaultBranchRef: {
        target: { history: { totalCount: number } };
      } | null;
    }[];
  };
  ownedRepoStars: {
    nodes: {
      stargazerCount: number;
      forkCount: number;
      watchers: { totalCount: number };
    }[];
  };
}

// ---------------------------------------------------------------------------
// GitHub GraphQL Query
// ---------------------------------------------------------------------------

/**
 * GitHub GraphQL query for fetching a user's contribution data over 365 days.
 *
 * Variables:
 * - $login: String! — GitHub username
 * - $since: DateTime! — Start of window (contributionsCollection)
 * - $until: DateTime! — End of window (contributionsCollection)
 * - $historySince: GitTimestamp! — Start of window (commit history)
 * - $historyUntil: GitTimestamp! — End of window (commit history)
 *
 * Note: DateTime and GitTimestamp are different GraphQL types but accept
 * the same ISO 8601 strings. They must be declared as separate variables.
 */
export const CONTRIBUTION_QUERY = `
query($login: String!, $since: DateTime!, $until: DateTime!, $historySince: GitTimestamp!, $historyUntil: GitTimestamp!) {
  user(login: $login) {
    login
    name
    avatarUrl
    contributionsCollection(from: $since, to: $until) {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            date
            contributionCount
          }
        }
      }
      pullRequestContributions(first: 100) {
        totalCount
        nodes {
          pullRequest {
            additions
            deletions
            changedFiles
            merged
          }
        }
      }
      pullRequestReviewContributions(first: 1) {
        totalCount
      }
      issueContributions(first: 1) {
        totalCount
      }
    }
    repositories(first: 20, ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER], orderBy: {field: PUSHED_AT, direction: DESC}) {
      totalCount
      nodes {
        nameWithOwner
        defaultBranchRef {
          target {
            ... on Commit {
              history(since: $historySince, until: $historyUntil) {
                totalCount
              }
            }
          }
        }
      }
    }
    ownedRepos: repositories(ownerAffiliations: OWNER, first: 100, orderBy: {field: STARGAZERS, direction: DESC}) {
      nodes { stargazerCount forkCount watchers { totalCount } }
    }
  }
}
`;

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

/** Compute a weight for a single PR based on size and complexity. */
export function computePrWeight(pr: {
  additions: number;
  deletions: number;
  changedFiles: number;
}): number {
  const w =
    0.5 +
    0.25 * Math.log(1 + pr.changedFiles) +
    0.25 * Math.log(1 + pr.additions + pr.deletions);
  return Math.min(w, 3.0);
}

// ---------------------------------------------------------------------------
// Stats aggregation
// ---------------------------------------------------------------------------

/**
 * Transform raw GitHub GraphQL contribution data into a StatsData object.
 *
 * Pure function — deterministic output for a given input
 * (except for `fetchedAt` which uses the current time).
 */
export function buildStatsFromRaw(raw: RawContributionData): StatsData {
  // 1. Flatten heatmap from weeks -> HeatmapDay[]
  const heatmapData: HeatmapDay[] = [];
  for (const week of raw.contributionCalendar.weeks) {
    for (const day of week.contributionDays) {
      heatmapData.push({ date: day.date, count: day.contributionCount });
    }
  }

  // 2. Count active days
  const activeDays = heatmapData.filter((d) => d.count > 0).length;

  // 3. Total commits from contribution calendar
  const commitsTotal = raw.contributionCalendar.totalContributions;

  // 4. PRs: only count merged, compute weight
  const mergedPRs = raw.pullRequests.nodes.filter((pr) => pr.merged);
  const prsMergedCount = mergedPRs.length;
  const prsMergedWeight = Math.min(
    mergedPRs.reduce((sum, pr) => sum + computePrWeight(pr), 0),
    PR_WEIGHT_AGG_CAP,
  );

  // 5. Lines added/deleted from merged PRs
  const linesAdded = mergedPRs.reduce((sum, pr) => sum + pr.additions, 0);
  const linesDeleted = mergedPRs.reduce((sum, pr) => sum + pr.deletions, 0);

  // 6. Reviews and issues
  const reviewsSubmittedCount = raw.reviews.totalCount;
  const issuesClosedCount = raw.issues.totalCount;

  // 7. Repos contributed to (with commits in the period)
  const repoCommits = raw.repositories.nodes
    .map((r) => ({
      name: r.nameWithOwner,
      commits: r.defaultBranchRef?.target?.history?.totalCount ?? 0,
    }))
    .filter((r) => r.commits > 0);
  const reposContributed = repoCommits.length;

  // 8. Top repo share
  const totalRepoCommits = repoCommits.reduce((s, r) => s + r.commits, 0);
  const topRepoShare =
    totalRepoCommits > 0
      ? Math.max(...repoCommits.map((r) => r.commits)) / totalRepoCommits
      : 0;

  // 9. maxCommitsIn10Min approximation from daily spikes
  const maxDailyCount = Math.max(...heatmapData.map((d) => d.count), 0);
  const maxCommitsIn10Min = maxDailyCount >= 30 ? maxDailyCount : 0;

  // 10. Total stars, forks, and watchers across owned repos
  const totalStars = raw.ownedRepoStars.nodes.reduce(
    (sum, r) => sum + r.stargazerCount,
    0,
  );
  const totalForks = raw.ownedRepoStars.nodes.reduce(
    (sum, r) => sum + r.forkCount,
    0,
  );
  const totalWatchers = raw.ownedRepoStars.nodes.reduce(
    (sum, r) => sum + r.watchers.totalCount,
    0,
  );

  return {
    handle: raw.login,
    displayName: raw.name ?? undefined,
    avatarUrl: raw.avatarUrl,
    commitsTotal,
    activeDays,
    prsMergedCount,
    prsMergedWeight,
    reviewsSubmittedCount,
    issuesClosedCount,
    linesAdded,
    linesDeleted,
    reposContributed,
    topRepoShare,
    maxCommitsIn10Min,
    totalStars,
    totalForks,
    totalWatchers,
    heatmapData,
    fetchedAt: new Date().toISOString(),
  };
}
