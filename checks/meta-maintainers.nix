{ pkgs, packages }:
let
  derivations = pkgs.lib.filterAttrs (_: package: pkgs.lib.isDerivation package) packages;

  forced = pkgs.lib.mapAttrsToList (
    _name: package: builtins.deepSeq (package.meta.maintainers or [ ]) true
  ) derivations;
in
pkgs.runCommand "meta-maintainers-check"
  {
    inherit forced;
  }
  ''
    echo "All package meta.maintainers evaluated successfully"
    touch $out
  ''
