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
      let
        systems = [
          "x86_64-linux"
          "aarch64-linux"
          "aarch64-darwin"
        ];

        pkgsFor =
          system:
          import inputs.nixpkgs {
            inherit system;
            config.allowUnfree = true;
          };
      in
      {
        inherit systems;

        imports = [ inputs.treefmt-nix.flakeModule ];

        perSystem =
          { system, config, ... }:
          let
            pkgs = pkgsFor system;
            nur = import ./default.nix { inherit pkgs; };
            nurPackages = lib.filterAttrs (
              _name: package: lib.isDerivation package && lib.meta.availableOn pkgs.stdenv.hostPlatform package
            ) nur;
          in
          {
            _module.args.pkgs = pkgs;

            packages = nurPackages // {
              default = pkgs.callPackage ./packages/default/package.nix {
                packages = nurPackages;
              };
            };

            checks = {
              package-metadata = import ./checks/package-metadata.nix {
                inherit pkgs;
                packages = config.packages;
              };
              meta-maintainers = import ./checks/meta-maintainers.nix {
                inherit pkgs;
                packages = config.packages;
              };
            };

            treefmt = {
              projectRootFile = "flake.lock";
              flakeCheck = false;

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

        flake = {
          legacyPackages = lib.genAttrs systems (system: import ./default.nix { pkgs = pkgsFor system; });

          overlays = {
            default = import ./overlays/nur-packages.nix {
              packages = inputs.self.packages;
            };
            shared-nixpkgs = import ./overlays/shared-nixpkgs.nix;
          };

          nixosModules = {
            usque = import ./modules/nixos/usque.nix;
          };

          homeModules = {
            helium = import ./modules/hm/helium.nix;
          };

          darwinModules = {
            sparkle = import ./modules/darwin/sparkle.nix;
            synthesizer-v-studio-2-pro = import ./modules/darwin/synthesizer-v-studio-2-pro.nix;
            uuremote = import ./modules/darwin/uuremote.nix;
          };
        };
      }
    );
}
