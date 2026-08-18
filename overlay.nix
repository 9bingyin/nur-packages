# Flat NUR-compatible overlay. Packages are exposed at top level, e.g. pkgs.longbridge.
final: prev:
prev.lib.filesystem.packagesFromDirectoryRecursive {
  directory = ./packages;
  callPackage = final.callPackage;
}
