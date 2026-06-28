{
  description = "9bingyin's NUR package repository";

  nixConfig = {
    extra-substituters = [
      "https://9bingyin.cachix.org"
      "https://cache.bingyin.org/9bingyin"
    ];
    extra-trusted-public-keys = [
      "9bingyin.cachix.org-1:uXB+kYLEeHo6kpX8NIZtRwwPozYR/JRNRMeFaObkvDo="
      "9bingyin:90z35xmUYWimWPICqCJt7rzJ6wo+fagx7t0v9MCCeQo="
    ];
  };

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    systems.url = "github:nix-systems/default";

    blueprint = {
      url = "github:numtide/blueprint";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.systems.follows = "systems";
    };

    treefmt-nix = {
      url = "github:numtide/treefmt-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    flake-parts = {
      url = "github:hercules-ci/flake-parts";
      inputs.nixpkgs-lib.follows = "nixpkgs";
    };
  };

  outputs =
    inputs:
    let
      inherit (inputs.nixpkgs) lib;

      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];

      mkPkgsFor =
        system:
        import inputs.nixpkgs {
          inherit system;
          config.allowUnfree = true;
        };

      legacyPackages = lib.genAttrs systems (system: import ./default.nix { pkgs = mkPkgsFor system; });

      blueprintOutputs = inputs.blueprint {
        inherit inputs;
        inherit systems;
        nixpkgs.config.allowUnfree = true;
      };
    in
    blueprintOutputs
    // {
      inherit legacyPackages;

      overlays = {
        default = import ./overlays/nur-packages.nix {
          packages = blueprintOutputs.packages;
        };
        shared-nixpkgs = import ./overlays/shared-nixpkgs.nix {
          inherit (blueprintOutputs) mkPackagesFor;
        };
      };

      nixosModules = {
        mihomo-warp = import ./modules/nixos/mihomo-warp.nix;
        usque = import ./modules/nixos/usque.nix;
      };
    };
}
