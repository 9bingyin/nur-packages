{
  nixosModules = {
    usque = ./nixos/usque.nix;
    vocat = ./nixos/vocat.nix;
  };
  homeModules = {
    helium = ./hm/helium.nix;
  };
  darwinModules = {
    sparkle = ./darwin/sparkle.nix;
    synthesizer-v-studio-2-pro = ./darwin/synthesizer-v-studio-2-pro.nix;
    uuremote = ./darwin/uuremote.nix;
  };
}
