{
  inputs,
  pkgs,
  ...
}:
inputs.treefmt-nix.lib.mkWrapper pkgs {
  _file = __curPos.file;
  package = pkgs.treefmt;
  projectRootFile = "flake.lock";

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
}
