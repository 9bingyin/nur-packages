# NUR entrypoint. Flake outputs reuse this package set.
{
  pkgs ? import <nixpkgs> { },
}:
let
  lib = pkgs.lib.extend (
    _final: prev: {
      maintainers = prev.maintainers // import ./maintainers/maintainer-list.nix;
    }
  );

  callPackage = pkgs.newScope (
    packages
    // {
      inherit lib callPackage;
    }
  );

  packages = pkgs.lib.filesystem.packagesFromDirectoryRecursive {
    directory = ./packages;
    inherit callPackage;
  };
in
packages
// import ./modules
// {
  # Packages are built with the nixpkgs passed to this file. Flake's overlay
  # imports this file with the consumer's nixpkgs before applying it.
  overlays.default = _final: _prev: {
    nur-packages = pkgs.lib.filterAttrs (
      _name: package:
      pkgs.lib.isDerivation package
      && (
        (package.meta.platforms or [ ]) == [ ]
        || pkgs.lib.elem pkgs.stdenv.hostPlatform.system package.meta.platforms
      )
    ) packages;
  };
}
