<!-- rpi-overlay: skill=rpi-release; written-against=7e8b592b5170 -->
# Project overlay for rpi-release

## Procedure

Develop to main merge-commit promotion, ported from the retired `/release` command's "Develop-based flow".

- The release PR is `develop` to `main` directly, with no intermediate
  `release/vX.Y.Z` branch. It must use a merge commit. Never pass
  `--delete-branch`; `develop` is permanent.
- Before the owner-authorized publication, run these read-only checks. Both merge
  settings must be `true`, and the prospective release merge must be conflict-free
  and tree-identical to the integration candidate. Stop if either check fails.

  ```bash
  gh api "repos/$(gh repo view --json nameWithOwner --jq .nameWithOwner)" \
    --jq '{allow_merge_commit, allow_squash_merge}'
  git fetch origin
  developTree=$(git rev-parse 'origin/develop^{tree}')
  mergeTree=$(git merge-tree --write-tree origin/main origin/develop)
  test "$mergeTree" = "$developTree"
  ```

- Only after the owner authorizes publication: merge with `gh pr merge --merge`
  (add `--auto` only when auto-merge is authorized), never `--squash`; confirm the merge with `gh pr view --json state`; tag the release
  merge commit on `main`. The GitHub Release must target `main`: `publish.yml`
  hard-fails otherwise and then publishes to npm via OIDC trusted publishing.
  This overlay grants no publication authority.

Moved from the managed `.claude` and `.agents` copies of this skill on 2026-11-14 (chapa-cli commit 55c89fd).
