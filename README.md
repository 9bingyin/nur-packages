# nur-packages-template

**A template for [NUR](https://github.com/nix-community/NUR) repositories**

## Setup

1. Click on [Use this template](https://github.com/nix-community/nur-packages-template/generate) to start a repo based on this template. (Do _not_ fork it.)
2. Add your packages to the [pkgs](./pkgs) directory and to
   [default.nix](./default.nix)
   * Remember to mark the broken packages as `broken = true;` in the `meta`
     attribute, or travis (and consequently caching) will fail!
   * Library functions, modules and overlays go in the respective directories
3. Choose your CI: Depending on your preference you can use github actions (recommended) or [Travis ci](https://travis-ci.com).
   - Github actions: Change your NUR repo name and optionally add a cachix name in [.github/workflows/build.yml](./.github/workflows/build.yml) and change the cron timer
     to a random value as described in the file
   - Travis ci: Change your NUR repo name and optionally your cachix repo name in 
   [.travis.yml](./.travis.yml). Than enable travis in your repo. You can add a cron job in the repository settings on travis to keep your cachix cache fresh
5. Change your travis and cachix names on the README template section and delete
   the rest
6. [Add yourself to NUR](https://github.com/nix-community/NUR#how-to-add-your-own-repository)

## README template

# nur-packages

**My personal [NUR](https://github.com/nix-community/NUR) repository**

<!-- Remove this if you don't use github actions -->
![Build and populate cache](https://github.com/<YOUR-GITHUB-USER>/nur-packages/workflows/Build%20and%20populate%20cache/badge.svg)

<!--
Uncomment this if you use travis:

[![Build Status](https://travis-ci.com/<YOUR_TRAVIS_USERNAME>/nur-packages.svg?branch=master)](https://travis-ci.com/<YOUR_TRAVIS_USERNAME>/nur-packages)
-->
[![Cachix Cache](https://img.shields.io/badge/cachix-<YOUR_CACHIX_CACHE_NAME>-blue.svg)](https://<YOUR_CACHIX_CACHE_NAME>.cachix.org)

## PR Quality Checks

This repository includes comprehensive test suite for all packages. The PR checks workflow automatically runs on all pull requests to ensure code quality.

### Tests Included

- **Metadata validation**: Ensures all packages have required metadata (description, license, platforms)
- **Installation tests**: Verifies packages install correctly with all required files
- **Binary tests**: Checks that executables are available and functional
- **Package instantiation**: Validates packages can be instantiated without errors

### Configuring Required Checks

To enforce tests before merging PRs:

1. Go to your repository Settings → Branches
2. Add a branch protection rule for `main` (or `master`)
3. Enable "Require status checks to pass before merging"
4. Select "Package Tests" from the list of status checks
5. Enable "Require branches to be up to date before merging" (recommended)

This ensures all PRs must pass tests before they can be merged.

### Handling Unfree Packages

The test suite is configured to handle unfree packages (like `longbridge`). All test commands include `NIXPKGS_ALLOW_UNFREE=1` to prevent evaluation errors.

