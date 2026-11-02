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
    inputs.flake-parts.lib.mkFlake { inherit inputs; } (
      { lib, ... }:
      {
        systems = [
          "x86_64-linux"
          "aarch64-linux"
          "aarch64-darwin"
        ];

        imports = [ inputs.treefmt-nix.flakeModule ];

        perSystem =
          { system, config, ... }:
          let
            pkgs = import inputs.nixpkgs {
              inherit system;
              config.allowUnfree = true;
            };
            nur = import ./default.nix { inherit pkgs; };
            nurPackages = lib.filterAttrs (
              _name: package: lib.isDerivation package && lib.meta.availableOn pkgs.stdenv.hostPlatform package
            ) nur;
            visiblePackages = lib.filterAttrs (_name: lib.isDerivation) nurPackages;
            requiredMetadata = [
              "description"
              "homepage"
              "license"
              "maintainers"
              "mainProgram"
            ];
            isEvaluable = value: (builtins.tryEval (builtins.deepSeq value true)).success;
            missingMetadata = lib.concatMap (
              name:
              let
                package = visiblePackages.${name};
              in
              map (field: "${name}.meta.${field}") (
                builtins.filter (
                  field: !(package.meta ? ${field}) || !isEvaluable package.meta.${field}
                ) requiredMetadata
              )
            ) (builtins.attrNames visiblePackages);
            maintainersEvaluated = lib.mapAttrsToList (
              _name: package: builtins.deepSeq (package.meta.maintainers or [ ]) true
            ) visiblePackages;
          in
          {
            _module.args.pkgs = pkgs;

            legacyPackages = nur;
            packages = nurPackages;

            checks = {
              package-metadata =
                if missingMetadata != [ ] then
                  throw "Packages must declare evaluable metadata: ${builtins.concatStringsSep ", " missingMetadata}"
                else
                  pkgs.runCommand "package-metadata-check" { } ''
                    echo "All visible packages declare the required metadata"
                    touch $out
                  '';
              meta-maintainers =
                pkgs.runCommand "meta-maintainers-check"
                  {
                    inherit maintainersEvaluated;
                  }
                  ''
                    echo "All package meta.maintainers evaluated successfully"
                    touch $out
                  '';
            }
            // lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
              vocat = import ./checks/vocat.nix {
                inherit pkgs;
                package = nur.vocat;
              };
            };

            treefmt = {
              projectRootFile = "flake.lock";
              flakeCheck = false;

              programs.biome = {
                enable = true;
                includes = [
                  ".github/scripts/*.ts"
                  "packages/*/update.ts"
                ];
              };
              programs.nixfmt.enable = true;
              programs.ruff-format.enable = true;
              programs.shellcheck.enable = true;
              programs.shfmt.enable = true;
              programs.yamlfmt = {
                enable = true;
                settings.formatter = {
                  retain_line_breaks_single = true;
                  scan_folded_as_literal = true;
                };
              };
            };
          };

        flake =
          let
            modules = import ./default.nix {
              pkgs = import inputs.nixpkgs {
                system = "x86_64-linux";
                config.allowUnfree = true;
              };
            };
          in
          {
            overlays.default =
              final: prev: (import ./default.nix { pkgs = final; }).overlays.default final prev;
            nixosModules = modules.nixosModules;
            homeModules = modules.homeModules;
            darwinModules = modules.darwinModules;
          };
      }
    );
}
