# nur-packages

[![Cache](https://github.com/9bingyin/nur-packages/actions/workflows/cache.yml/badge.svg)](https://github.com/9bingyin/nur-packages/actions/workflows/cache.yml)

```nix
{
  inputs.nur-9bingyin.url = "github:9bingyin/nur-packages";
}
```

Binary cache: `https://cache.bingyin.org`

Public key: `cache.bingyin.org-1:PU5qCuJfhYPKSIRdOMCndVB6Dn9rRRIRVZAnG2uAPSI=`

`packages.*` uses the nixpkgs revision locked in this repo. The cache stores those builds. Leave `inputs.nur-9bingyin.inputs.nixpkgs.follows` unset.

## Packages

```nix
environment.systemPackages = [
  inputs.nur-9bingyin.packages.${pkgs.stdenv.hostPlatform.system}.cf
];
```

```shell
nix run github:9bingyin/nur-packages#cf
```

The overlay builds the same packages with your nixpkgs, under `pkgs.nur-packages`. The cache matches only when that nixpkgs revision matches this repo.

```nix
nixpkgs.overlays = [ inputs.nur-9bingyin.overlays.default ];

environment.systemPackages = [
  pkgs.nur-packages.cf
];
```

The repo builds `x86_64-linux`, `aarch64-linux`, and `aarch64-darwin`. Each package lists its systems in `meta.platforms`.

## Modules

Add a module to `imports`. `homeModules` and `darwinModules` work the same way. The module sets its own package option.

```nix
imports = [
  inputs.nur-9bingyin.nixosModules.vocat
];
```
