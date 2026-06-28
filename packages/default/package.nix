{
  lib,
  writeShellApplication,
  fzf,
  nix,
  util-linux,
  perSystem,
  ...
}:
let
  allPackages = perSystem.self;

  visibleNames = builtins.filter (
    name:
    name != "default" && name != "formatter" && !(allPackages.${name}.passthru.hideFromDocs or false)
  ) (builtins.attrNames allPackages);

  packageLines = map (name: "${name}\t${allPackages.${name}.meta.description or ""}") visibleNames;
  packageListFile = builtins.toFile "nur-packages.tsv" (builtins.concatStringsSep "\n" packageLines);
in
writeShellApplication {
  name = "nur-packages-launcher";

  runtimeInputs = [
    fzf
    nix
    util-linux
  ];

  text = ''
    entries=$(column -t -s $'\t' < "${packageListFile}")

    if [[ -z $entries ]]; then
      echo "No packages found" >&2
      exit 1
    fi

    selected=$(echo "$entries" | fzf \
      --header="Select a package to run (ESC to cancel)" \
      --preview-window=hidden \
      --no-multi \
      --height=~40% \
      --layout=reverse) || exit 0

    package_name=$(echo "$selected" | awk '{print $1}')

    if [[ -z $package_name ]]; then
      exit 0
    fi

    echo "Running: nix run github:9bingyin/nur-packages#$package_name"
    exec nix run "github:9bingyin/nur-packages#$package_name"
  '';

  meta = {
    description = "Interactive fzf launcher for nur-packages";
    license = lib.licenses.mit;
    mainProgram = "nur-packages-launcher";
    platforms = lib.platforms.all;
  };

  passthru.hideFromDocs = true;
}
