{
  description = "9bingyin's NUR package repository";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    flake-parts = {
      url = "github:hercules-ci/flake-parts";
      inputs.nixpkgs-lib.follows = "nixpkgs";
    };

    treefmt-nix = {
      url = "github:numtide/treefmt-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    inputs:
    inputs.flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];

      imports = [ inputs.treefmt-nix.flakeModule ];

      perSystem =
        {
          system,
          pkgs,
          lib,
          config,
          ...
        }:
        {
          _module.args.pkgs = import inputs.nixpkgs {
            inherit system;
            config.allowUnfree = true;
          };

          legacyPackages = import ./default.nix { inherit pkgs; };
          packages = lib.filterAttrs (
            _name: package: lib.isDerivation package && lib.meta.availableOn pkgs.stdenv.hostPlatform package
          ) config.legacyPackages;

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
                    package = config.packages.${name};
                  in
                  map (field: "${name}.meta.${field}") (
                    builtins.filter (
                      field:
                      !(package.meta ? ${field})
                      || !(builtins.tryEval (builtins.deepSeq package.meta.${field} true)).success
                    ) required
                  )
                ) (builtins.attrNames config.packages);
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
                  ) config.packages;
                }
                ''
                  echo "All package meta.maintainers evaluated successfully"
                  touch $out
                '';
          }
          // lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
            vocat = import ./checks/vocat.nix {
              inherit pkgs;
              package = config.packages.vocat;
            };
          };

          treefmt = {
            programs.nixfmt.enable = true;
            programs.biome = {
              enable = true;
              excludes = [
                "*.json"
                "*.jsonc"
              ];
              settings = {
                formatter = {
                  indentStyle = "space";
                  indentWidth = 2;
                };
                javascript.formatter = {
                  quoteStyle = "single";
                  semicolons = "asNeeded";
                };
              };
            };
            programs.yamlfmt = {
              enable = true;
              settings.formatter.retain_line_breaks = true;
            };
          };
        };

      flake = {
        inherit (import ./modules)
          nixosModules
          homeModules
          darwinModules
          ;
        overlays.default =
          final: prev: (import ./default.nix { pkgs = final; }).overlays.default final prev;
      };
    };
}
