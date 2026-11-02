# AGENTS.md

## Platforms

Supported systems are `x86_64-linux`, `aarch64-linux`, and `aarch64-darwin`.

Write `meta.platforms` with `lib.platforms`.

- All three systems: `lib.intersectLists (lib.platforms.linux ++ lib.platforms.darwin) (lib.platforms.x86_64 ++ lib.platforms.aarch64)`
- Darwin: `lib.platforms.darwin`
- Linux x86_64 and aarch64: `lib.intersectLists lib.platforms.linux (lib.platforms.x86_64 ++ lib.platforms.aarch64)`

`lib.platforms.darwin` is `aarch64-darwin`. List the systems the package builds.

## Descriptions

Follow nixpkgs `meta.description`. Write one capitalized sentence. Start with a specific noun or adjective. Drop a leading article and the package name. Leave off the final period.

When nixpkgs already has the package and this repo ships that package or a binary build, copy the nixpkgs description as written. Keep the platforms from the section above.

For any other package, use the upstream description and edit the wording until it matches those rules.

Add each maintainer to `maintainers/maintainer-list.nix`, then set `maintainers` to the matching `lib.maintainers` entries.

## Updates

A package with an upstream release gets `passthru.updateScript`. `synthesizer-v-studio-2-pro` has no update script.

Use `nix-update-script` for a version and hash bump.

When the update also rewrites extra sources or commit text, add `update.ts` and set `passthru.updateScript = ./update.ts`. Write that script in TypeScript and run it with bun:

```ts
#!/usr/bin/env nix
/*
#! nix shell --inputs-from . nixpkgs#bun --command bun
*/
```
