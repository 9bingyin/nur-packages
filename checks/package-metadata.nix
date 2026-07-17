{ pkgs, perSystem, ... }:
let
  visiblePackages = pkgs.lib.filterAttrs (
    _name: package: pkgs.lib.isDerivation package && !(package.passthru.hideFromDocs or false)
  ) perSystem.self;

  requiredFields = [
    "description"
    "homepage"
    "license"
    "maintainers"
    "mainProgram"
  ];

  isEvaluable = value: (builtins.tryEval (builtins.deepSeq value true)).success;

  missingFields = pkgs.lib.concatMap (
    name:
    let
      package = visiblePackages.${name};
    in
    map (field: "${name}.meta.${field}") (
      builtins.filter (
        field: !(package.meta ? ${field}) || !isEvaluable package.meta.${field}
      ) requiredFields
    )
  ) (builtins.attrNames visiblePackages);
in
if missingFields != [ ] then
  throw "Packages must declare evaluable metadata: ${builtins.concatStringsSep ", " missingFields}"
else
  pkgs.runCommand "package-metadata-check" { } ''
    echo "All visible packages declare the required metadata"
    touch $out
  ''
