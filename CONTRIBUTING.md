# Contributing to chapa-cli

Thanks for your interest in contributing! This project was extracted from the main Chapa monorepo specifically so the community can help improve it.

## Ways to Contribute

- Report bugs or suggest features via [GitHub Issues](https://github.com/juan294/chapa-cli/issues)
- Fix bugs or implement features via pull requests
- Improve documentation
- Share your experience with corporate proxy/TLS configurations

### Contributions We'd Love

- Fixes for specific corporate proxy/TLS configurations
- Windows compatibility improvements
- Better error messages for edge cases
- Support for additional authentication methods

## Development Setup

1. Fork and clone the repository:

   ```bash
   git clone https://github.com/<your-username>/chapa-cli.git
   cd chapa-cli
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Run tests to verify everything works:

   ```bash
   pnpm test
   ```

## Development Workflow

1. Create a feature branch from `develop`:

   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feat/your-feature
   ```

2. Make your changes and write tests.

3. Ensure all checks pass:

   ```bash
   pnpm test          # unit tests
   pnpm run typecheck # type checking
   pnpm run build     # production build
   ```

4. Open a pull request targeting the `develop` branch.

### Testing Against a Local Server

```bash
pnpm run build
node dist/index.js login --server http://localhost:3001
node dist/index.js merge --emu-handle your-emu --server http://localhost:3001
```

## Commit Format

Use lowercase [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add proxy support
fix: handle expired tokens gracefully
docs: update contributing guide
chore: bump dependencies
test: add coverage for auth module
refactor: simplify GraphQL query builder
```

## Pull Request Guidelines

- Target the `develop` branch (not `main`)
- Keep PRs focused — one feature or fix per PR
- Include tests for new functionality
- Update documentation if behavior changes
- Ensure CI passes before requesting review

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Security

If you discover a security vulnerability, please follow the [Security Policy](SECURITY.md) instead of opening a public issue.
