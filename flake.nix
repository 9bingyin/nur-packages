{
  description = "9bingyin's NUR package repository";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    { self, nixpkgs }:
    let
      lib = nixpkgs.lib;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      eachSystem = lib.genAttrs systems (
        system:
        let
          pkgs = import nixpkgs {
            inherit system;
            config.allowUnfree = true;
          };
          nur = import ./default.nix { inherit pkgs; };
          packages = lib.filterAttrs (
            _name: package: lib.isDerivation package && lib.meta.availableOn pkgs.stdenv.hostPlatform package
          ) nur;
          formatter = pkgs.treefmt.withConfig {
            runtimeInputs = [
              pkgs.biome
              pkgs.gitMinimal
              pkgs.nixfmt
              pkgs.yamlfmt
            ];
            settings = {
              on-unmatched = "info";
              formatter = {
                nixfmt = {
                  command = "nixfmt";
                  includes = [ "*.nix" ];
                };
                biome = {
                  command = "biome";
                  includes = [
                    "*.js"
                    "*.ts"
                    "*.mjs"
                    "*.mts"
                    "*.cjs"
                    "*.cts"
                    "*.jsx"
                    "*.tsx"
                    "*.d.ts"
                    "*.d.cts"
                    "*.d.mts"
                    "*.css"
                  ];
                  options = [
                    "check"
                    "--write"
                    "--no-errors-on-unmatched"
                    "--indent-style=space"
                    "--indent-width=2"
                    "--javascript-formatter-quote-style=single"
                    "--semicolons=as-needed"
                  ];
                };
                yamlfmt = {
                  command = "yamlfmt";
                  includes = [
                    "*.yaml"
                    "*.yml"
                  ];
                  options = [
                    "-formatter"
                    "retain_line_breaks=true"
                  ];
                };
              };
            };
          };
        in
        {
          legacyPackages = nur;
          inherit packages formatter;
          checks = {
            package-metadata =
              let
                required = [
                  "description"
                  "homepage"
                  "license"
                  "maintainers"
                  "mainProgram"
                ];
                missing = lib.concatMap (
                  name:
                  let
                    package = packages.${name};
                  in
                  map (field: "${name}.meta.${field}") (
                    builtins.filter (
                      field:
                      !(package.meta ? ${field})
                      || !(builtins.tryEval (builtins.deepSeq package.meta.${field} true)).success
                    ) required
                  )
                ) (builtins.attrNames packages);
              in
              if missing != [ ] then
                throw "Packages must declare evaluable metadata: ${builtins.concatStringsSep ", " missing}"
              else
                pkgs.runCommand "package-metadata-check" { } ''
                  echo "All visible packages declare the required metadata"
                  touch $out
                '';
            meta-maintainers =
              pkgs.runCommand "meta-maintainers-check"
                {
                  maintainersEvaluated = lib.mapAttrsToList (
                    _name: package: builtins.deepSeq (package.meta.maintainers or [ ]) true
                  ) packages;
                }
                ''
                  echo "All package meta.maintainers evaluated successfully"
                  touch $out
                '';
            treefmt = formatter.check self;
          }
          // lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
            vocat = import ./checks/vocat.nix {
              inherit pkgs;
              package = packages.vocat;
            };
          };
        }
      );
    in
    {
      inherit (import ./modules)
        nixosModules
        homeModules
        darwinModules
        ;
      overlays.default =
        final: prev: (import ./default.nix { pkgs = final; }).overlays.default final prev;
      legacyPackages = lib.mapAttrs (_: value: value.legacyPackages) eachSystem;
      packages = lib.mapAttrs (_: value: value.packages) eachSystem;
      checks = lib.mapAttrs (_: value: value.checks) eachSystem;
      formatter = lib.mapAttrs (_: value: value.formatter) eachSystem;
    };
}
