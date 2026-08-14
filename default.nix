# NUR-compatible entrypoint. Flake outputs reuse this package set.
{
  pkgs ? import <nixpkgs> { },
}:
let
  packages = pkgs.lib.filesystem.packagesFromDirectoryRecursive {
    directory = ./packages;
    callPackage = pkgs.callPackage;
  };
in
{
  nixosModules = {
    usque = ./modules/nixos/usque.nix;
  };
  homeModules = {
    helium = ./modules/hm/helium.nix;
  };
  darwinModules = {
    sparkle = ./modules/darwin/sparkle.nix;
    synthesizer-v-studio-2-pro = ./modules/darwin/synthesizer-v-studio-2-pro.nix;
    uuremote = ./modules/darwin/uuremote.nix;
  };
  overlays = import ./overlays;
}
// packages
