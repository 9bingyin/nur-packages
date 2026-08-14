# NUR-compatible entrypoint. Flake outputs reuse this package set.
{
  pkgs ? import <nixpkgs> { },
}:
let
  inherit (pkgs) lib;

  packageDirs = lib.filterAttrs (
    name: type: type == "directory" && builtins.pathExists (./packages + "/${name}/default.nix")
  ) (builtins.readDir ./packages);

  packages = lib.mapAttrs (name: _: import (./packages + "/${name}") { inherit pkgs; }) packageDirs;
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
