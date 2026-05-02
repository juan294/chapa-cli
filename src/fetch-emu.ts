import type { StatsData, RawContributionData } from "./shared.js";
import { CONTRIBUTION_QUERY, buildStatsFromRaw, SCORING_WINDOW_DAYS, extractErrorDetail } from "./shared.js";
import type { Logger } from "./logger.js";
import { requestJson, type RequestResult } from "./http.js";
import type { TelemetryPayload } from "./telemetry.js";

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
          pageInfo?: {
            hasNextPage: boolean;
            endCursor: string | null;
          };
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

type GraphQLUser = NonNullable<NonNullable<GraphQLResponse["data"]>["user"]>;
type PullRequestContributionConnection = GraphQLUser["contributionsCollection"]["pullRequestContributions"];
type PullRequestContributionNode = NonNullable<PullRequestContributionConnection["nodes"][number]>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Maximum characters to log from error response bodies or GraphQL errors. */
const MAX_ERROR_BODY_LENGTH = 200;

/** Maximum number of GraphQL pullRequestContributions pagination pages.
 *  Each page returns up to 100 PRs, so this caps total PRs at ~5 000.
 *  Guards against runaway pagination if upstream pageInfo misbehaves. */
const MAX_PR_PAGES = 50;

/** Truncate a string to the given max length, appending "..." if truncated. */
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

function logError(log: Logger | undefined, message: string): void {
  if (log) {
    log.error(message);
    return;
  }

  console.error(message);
}

function normalizePullRequestNodes(
  nodes: PullRequestContributionConnection["nodes"],
): RawContributionData["pullRequests"]["nodes"] {
  return nodes
    .filter(
      (n): n is PullRequestContributionNode & { pullRequest: NonNullable<PullRequestContributionNode["pullRequest"]> } =>
        n != null && n.pullRequest != null,
    )
    .map((n) => n.pullRequest);
}

// ---------------------------------------------------------------------------
// Fetch EMU stats via GraphQL (requires EMU token with auth)
// ---------------------------------------------------------------------------

interface FetchEmuOptions {
  logger?: Logger;
}

type FetchEmuResult =
  | { ok: true; stats: StatsData }
  | {
      ok: false;
      error: string;
      errorCategory: TelemetryPayload["errorCategory"];
    };

function classifyFetchFailure(result: {
  category: "timeout" | "network" | "http" | "parse";
  status?: number;
}): TelemetryPayload["errorCategory"] {
  if (result.category === "timeout" || result.category === "network") {
    return "network";
  }

  if (result.category === "http") {
    if (result.status === 401 || result.status === 403) {
      return "auth";
    }
    if (result.status && result.status >= 500) {
      return "server";
    }
    return "graphql";
  }

  return "graphql";
}

function formatTransportFailure(result: {
  category: "timeout" | "network" | "http" | "parse";
  message: string;
  status?: number;
  body?: unknown;
  text?: string;
}): { error: string; logMessage: string; errorCategory: TelemetryPayload["errorCategory"] } {
  if (result.category === "http") {
    const bodyText = result.text
      ? result.text
      : result.body !== undefined
        ? JSON.stringify(result.body)
        : "Unknown error";
    const error = `GraphQL HTTP ${result.status}: ${truncate(bodyText, MAX_ERROR_BODY_LENGTH)}`;
    return {
      error,
      logMessage: `[cli] ${error}`,
      errorCategory: classifyFetchFailure(result),
    };
  }

  return {
    error: result.message,
    logMessage: `[cli] fetch error: ${result.message}`,
    errorCategory: classifyFetchFailure(result),
  };
}

export async function fetchEmuStats(
  login: string,
  emuToken: string,
  opts?: FetchEmuOptions,
): Promise<FetchEmuResult> {
  const log = opts?.logger;
  const now = new Date();
  const since = new Date(now);
  since.setDate(since.getDate() - SCORING_WINDOW_DAYS);

  log?.debug(`Scoring window: ${since.toISOString()} → ${now.toISOString()}`);

  const requestPage = async (prCursor: string | null): Promise<RequestResult<GraphQLResponse>> =>
    requestJson<GraphQLResponse>({
      url: "https://api.github.com/graphql",
      method: "POST",
      headers: {
        Accept: "application/json",
      },
      token: emuToken,
      timeoutMs: 30_000,
      body: {
        query: CONTRIBUTION_QUERY,
        variables: {
          login,
          since: since.toISOString(),
          until: now.toISOString(),
          historySince: since.toISOString(),
          historyUntil: now.toISOString(),
          prCursor,
        },
      },
    });

  try {
    const res = await requestPage(null);

    if (!res.ok) {
      const failure = formatTransportFailure(res);
      logError(log, failure.logMessage);
      return {
        ok: false,
        error: failure.error,
        errorCategory: failure.errorCategory,
      };
    }

    const json = res.data;

    if (json.errors) {
      const errStr = truncate(JSON.stringify(json.errors), MAX_ERROR_BODY_LENGTH);
      const msg = `[cli] GraphQL errors for ${login}: ${errStr}`;
      logError(log, msg);
    }

    if (!json.data?.user) {
      const msg = `[cli] GitHub user not found or inaccessible: ${login}`;
      logError(log, msg);
      return {
        ok: false,
        error: "GitHub user not found or inaccessible",
        errorCategory: json.errors?.length ? "graphql" : "unknown",
      };
    }

    const user = json.data.user;
    const cc = user.contributionsCollection;

    const prNodes = normalizePullRequestNodes(cc.pullRequestContributions.nodes);
    let { hasNextPage, endCursor } = cc.pullRequestContributions.pageInfo ?? {
      hasNextPage: false,
      endCursor: null,
    };

    let pagesFetched = 0;
    while (hasNextPage) {
      if (pagesFetched >= MAX_PR_PAGES) {
        const msg = `[cli] GraphQL pagination exceeded maximum of ${MAX_PR_PAGES} pages for ${login}`;
        logError(log, msg);
        return {
          ok: false,
          error: `GraphQL pagination exceeded ${MAX_PR_PAGES} pages — aborting to avoid runaway requests`,
          errorCategory: "graphql",
        };
      }

      if (!endCursor) {
        const msg = `[cli] GraphQL pagination error for ${login}: missing endCursor`;
        logError(log, msg);
        return {
          ok: false,
          error: "GraphQL pagination error: missing endCursor",
          errorCategory: "graphql",
        };
      }

      const pageRes = await requestPage(endCursor);
      if (!pageRes.ok) {
        const failure = formatTransportFailure(pageRes);
        logError(log, failure.logMessage);
        return {
          ok: false,
          error: failure.error,
          errorCategory: failure.errorCategory,
        };
      }

      const pageJson = pageRes.data;

      if (pageJson.errors) {
        const errStr = truncate(JSON.stringify(pageJson.errors), MAX_ERROR_BODY_LENGTH);
        logError(log, `[cli] GraphQL errors for ${login}: ${errStr}`);
      }

      if (!pageJson.data?.user) {
        const msg = `[cli] GitHub user not found or inaccessible: ${login}`;
        logError(log, msg);
        return {
          ok: false,
          error: "GitHub user not found or inaccessible",
          errorCategory: pageJson.errors?.length ? "graphql" : "unknown",
        };
      }

      const pageConnection = pageJson.data.user.contributionsCollection.pullRequestContributions;
      const pageInfo = pageConnection.pageInfo ?? {
        hasNextPage: false,
        endCursor: null,
      };
      prNodes.push(...normalizePullRequestNodes(pageConnection.nodes));
      hasNextPage = pageInfo.hasNextPage;
      endCursor = pageInfo.endCursor;
      pagesFetched++;
    }

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

    return {
      ok: true,
      stats: buildStatsFromRaw(raw),
    };
  } catch (err) {
    const detail = extractErrorDetail(err as Error);
    const msg = `[cli] fetch error: ${detail}`;
    logError(log, msg);
    return {
      ok: false,
      error: detail,
      errorCategory: "unknown",
    };
  }
}
