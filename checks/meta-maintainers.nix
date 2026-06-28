{ pkgs, perSystem, ... }:
let
  packages = pkgs.lib.filterAttrs (_: package: pkgs.lib.isDerivation package) perSystem.self;

  forced = pkgs.lib.mapAttrsToList (
    _name: package: builtins.deepSeq (package.meta.maintainers or [ ]) true
  ) packages;
in
pkgs.runCommand "meta-maintainers-check"
  {
    inherit forced;
  }
  ''
    echo "All package meta.maintainers evaluated successfully"
    touch $out
  ''
