{
  pkgs,
  packages,
}:
pkgs.callPackage ./package.nix { inherit packages; }
