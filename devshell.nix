{ pkgs, perSystem, ... }:
pkgs.mkShellNoCC {
  packages = [
    pkgs.bash
    pkgs.coreutils
    pkgs.curl
    pkgs.git
    pkgs.gh
    pkgs.jq
    pkgs.nix-update
    pkgs.python3
    (perSystem.self.formatter or pkgs.nixfmt-tree)
  ];

  shellHook = ''
    export PRJ_ROOT=$PWD
    if [[ -d .git ]]; then
      install -Dm755 scripts/pre-push.py .git/hooks/pre-push
    fi
  '';
}
