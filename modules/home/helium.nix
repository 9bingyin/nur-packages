{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.programs.helium;
  preferences = "${config.home.homeDirectory}/Library/Application Support/net.imput.helium/Default/Preferences";
  autoUpdateJSON = if cfg.autoUpdate then "true" else "false";
in
{
  options.programs.helium = {
    enable = lib.mkEnableOption "Helium browser";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ../../packages/helium { };
      defaultText = lib.literalExpression "pkgs.callPackage ../../packages/helium { }";
      description = "The Helium package to install.";
    };

    autoUpdate = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        Whether Helium may download application and component updates itself.
        Keep this disabled when Nix manages the application version.
      '';
    };
  };

  config = {
    assertions = [
      {
        assertion = !cfg.enable || pkgs.stdenv.hostPlatform.isDarwin;
        message = "programs.helium is only supported on darwin";
      }
    ];

    home.packages = lib.mkIf cfg.enable [ cfg.package ];

    home.activation.heliumUpdatePreference = lib.mkIf cfg.enable (
      lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        preferences=${lib.escapeShellArg preferences}
        preferencesDirectory="$(/usr/bin/dirname "$preferences")"
        autoUpdate=${lib.escapeShellArg autoUpdateJSON}

        if [ -e "$preferences" ] && [ ! -f "$preferences" ]; then
          echo "Helium preferences path is not a regular file: $preferences" >&2
          exit 1
        fi

        /bin/mkdir -p "$preferencesDirectory"
        temporary="$(/usr/bin/mktemp "$preferencesDirectory/.Preferences.XXXXXX")"
        /bin/chmod 600 "$temporary"

        if [ -f "$preferences" ]; then
          ${lib.getExe pkgs.jq} --argjson autoUpdate "$autoUpdate" \
            '.helium.services.update_fetching_enabled = $autoUpdate' \
            "$preferences" > "$temporary"
        else
          printf '{"helium":{"services":{"update_fetching_enabled":%s}}}\n' "$autoUpdate" > "$temporary"
        fi

        /bin/mv "$temporary" "$preferences"
      ''
    );
  };
}
