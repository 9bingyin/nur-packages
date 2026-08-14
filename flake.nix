{
  description = "9bingyin's NUR package repository";

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
