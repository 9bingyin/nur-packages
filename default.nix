# NUR entrypoint. Flake outputs reuse this package set.
{
  pkgs ? import <nixpkgs> { },
}:
let
  packages = pkgs.lib.filesystem.packagesFromDirectoryRecursive {
    directory = ./packages;
    callPackage = pkgs.newScope packages;
  };

  nixosModules = {
    usque = ./modules/nixos/usque.nix;
    vocat = ./modules/nixos/vocat.nix;
  };
  homeModules = {
    helium = ./modules/hm/helium.nix;
  };
  darwinModules = {
    sparkle = ./modules/darwin/sparkle.nix;
    synthesizer-v-studio-2-pro = ./modules/darwin/synthesizer-v-studio-2-pro.nix;
    uuremote = ./modules/darwin/uuremote.nix;
  };
in
packages
// {
  inherit
    nixosModules
    homeModules
    darwinModules
    ;
  # Packages are built with the nixpkgs passed to this file. Flake's overlay
  # imports this file with the consumer's nixpkgs before applying it.
  overlays.default =
    _final: _prev:
    let
      isSupportedPackage =
        _name: package:
        pkgs.lib.isDerivation package
        && (
          (package.meta.platforms or [ ]) == [ ]
          || pkgs.lib.elem pkgs.stdenv.hostPlatform.system package.meta.platforms
        );
    in
    {
      nur-packages = pkgs.lib.filterAttrs isSupportedPackage packages;
    };
}
