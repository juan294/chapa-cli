# Phase 1: Server — Bearer Auth for Insights + Recalculate

> **Project**: chapa (server repo at `/Users/juan/code/chapa`)
> **Prerequisite**: None
> **Must complete before**: Phase 4 (CLI upload depends on server accepting Bearer tokens)

## Objective

Add Bearer token authentication to `POST /api/insights` and `POST /api/recalculate` so the CLI can authenticate the same way it does for `POST /api/supplemental`.

## Changes

### 1. Extract shared auth resolver

**File**: `apps/web/lib/auth/resolve-request-auth.ts` (NEW)

Extract the `resolveHandle()` function from `apps/web/app/api/supplemental/route.ts:14-25` into a shared module so both endpoints can use it.

```pseudo
import { isCliToken, verifyCliToken } from "./cli-token"
import { fetchGitHubUser } from "./github"

// Try Bearer token first, fall back to session cookie
export async function resolveRequestAuth(request: Request):
  -> { handle: string } | null

  // 1. Check Authorization header
  authHeader = request.headers.get("Authorization")
  if authHeader?.startsWith("Bearer "):
    token = authHeader.slice(7)
    return resolveHandle(token)  // existing logic from supplemental

  // 2. Fall back to session cookie
  sessionSecret = process.env.NEXTAUTH_SECRET
  cookieHeader = request.headers.get("cookie")
  session = readSessionCookie(cookieHeader, sessionSecret)
  if session:
    return { handle: session.login }

  return null

// Existing function, moved from supplemental/route.ts
async function resolveHandle(token: string):
  if isCliToken(token):
    secret = process.env.NEXTAUTH_SECRET
    result = verifyCliToken(token, secret)
    return result  // { handle } | null
  // Fallback: GitHub PAT
  user = await fetchGitHubUser(token)
  return user ? { handle: user.login } : null
```

### 2. Update POST /api/insights

**File**: `apps/web/app/api/insights/route.ts`

Replace `requireSession(request)` with `resolveRequestAuth(request)`.

```pseudo
// BEFORE (line 20-21):
const { session, error } = requireSession(request);
if (error) return error;
// uses session.login

// AFTER:
const auth = await resolveRequestAuth(request);
if (!auth) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
// uses auth.handle
```

All downstream references to `session.login` change to `auth.handle`.

### 3. Update POST /api/recalculate

**File**: `apps/web/app/api/recalculate/route.ts`

Same pattern. Replace `requireSession(request)` with `resolveRequestAuth(request)`.

```pseudo
// BEFORE (line 27-28):
const { session, error } = requireSession(request);
if (error) return error;
// uses session.login, session.token

// AFTER:
const auth = await resolveRequestAuth(request);
if (!auth) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
// uses auth.handle
```

**Note**: `recalculate` currently uses `session.token` (the GitHub OAuth token) to call `getStats(handle, session.token)`. For CLI Bearer auth, the CLI token is NOT a GitHub token, so `getStats` should fall back to fetching stats without a user token (using the service's own GitHub App token or cached data). This is already supported — `getStats` has a fallback path for when no user token is available.

### 4. Update POST /api/supplemental to use shared resolver

**File**: `apps/web/app/api/supplemental/route.ts`

Replace the inline `resolveHandle()` function with the import from the shared module. Remove the local function definition (lines 14-25). The behavior is identical — this is a pure refactor.

### 5. Tests

**File**: `apps/web/lib/auth/resolve-request-auth.test.ts` (NEW)

- Test Bearer CLI token → resolves handle
- Test Bearer GitHub PAT → resolves handle via fetchGitHubUser
- Test session cookie → resolves handle via readSessionCookie
- Test no auth → returns null
- Test expired CLI token → returns null
- Test invalid Bearer token → returns null

**File**: Update existing `apps/web/app/api/insights/route.test.ts`

- Add test: POST with valid Bearer token → 200 success
- Add test: POST with invalid Bearer token → 401
- Add test: POST with no auth header and no cookie → 401

**File**: Update existing `apps/web/app/api/recalculate/route.test.ts`

- Same three tests as above

## Success Criteria

### Automated
- All existing tests pass
- New auth tests pass
- `POST /api/insights` accepts both Bearer tokens and session cookies
- `POST /api/supplemental` behavior unchanged (regression)

### Manual
- Deploy to staging
- `curl -X POST https://staging.chapa.../api/insights -H "Authorization: Bearer <cli-token>" -H "Content-Type: application/json" -d '<InsightsUpload JSON>'` → 200 with craft score
