{ pkgs, ... }:
{
  package = pkgs.treefmt;
  projectRootFile = "flake.lock";

  programs.nixfmt.enable = true;
  programs.shellcheck.enable = true;
  programs.shfmt.enable = true;

  settings.formatter.nixfmt.includes = [ "*.nix" ];
  settings.formatter.shellcheck.includes = [ "*.sh" ];
  settings.formatter.shfmt.includes = [ "*.sh" ];
}
