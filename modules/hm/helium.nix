{
  config,
  lib,
  pkgs,
  ...
}:
let
  inherit (lib) literalExpression mkOption types;

  cfg = config.programs.helium;
  configDirectory =
    if pkgs.stdenv.hostPlatform.isDarwin then
      "${config.home.homeDirectory}/Library/Application Support/net.imput.helium"
    else
      "${config.xdg.configHome}/net.imput.helium";
  heliumServicesOrigin =
    if cfg.services.origin == null then
      "https://services.helium.imput.net"
    else
      lib.removeSuffix "/" cfg.services.origin;
  heliumExtensionUpdateUrl = "${heliumServicesOrigin}/ext";
  heliumPreferences = {
    helium = {
      completed_onboarding = true;
      services = {
        enabled = cfg.services.enable;
        user_consented = cfg.services.enable;
        bangs = cfg.services.bangs;
        ext_proxy = cfg.services.extensionProxy;
        spellcheck_files = cfg.services.spellcheck;
        ublock_assets = cfg.services.ublockAssets;
        origin_override = if cfg.services.origin == null then "" else cfg.services.origin;
        browser_updates = cfg.autoUpdate;
      };
    };
  };
  extensionType = types.submodule {
    options = {
      id = mkOption {
        type = types.strMatching "[a-zA-Z]{32}";
        description = "The extension ID from the Chrome Web Store URL or an unpacked CRX.";
      };

      updateUrl = mkOption {
        type = types.str;
        default = heliumExtensionUpdateUrl;
        defaultText = literalExpression "\"${heliumExtensionUpdateUrl}\"";
        description = "URL of the extension update manifest.";
      };

      crxPath = mkOption {
        type = types.nullOr types.path;
        default = null;
        description = "Path to a locally installed extension CRX.";
      };

      version = mkOption {
        type = types.nullOr types.str;
        default = null;
        description = "Version of a locally installed extension CRX.";
      };
    };
  };
  extensionJson = ext: {
    name = "${configDirectory}/External Extensions/${ext.id}.json";
    value.text = builtins.toJSON (
      if ext.crxPath != null then
        {
          external_crx = ext.crxPath;
          external_version = ext.version;
        }
      else
        {
          external_update_url = ext.updateUrl;
        }
    );
  };
  dictionary = pkg: {
    name = "${configDirectory}/Dictionaries/${pkg.passthru.dictFileName}";
    value.source = pkg;
  };
  nativeMessagingHosts = pkgs.symlinkJoin {
    name = "helium-native-messaging-hosts";
    paths = cfg.nativeMessagingHosts;
  };
in
{
  options.programs.helium = {
    enable = lib.mkEnableOption "Helium browser";

    package = mkOption {
      type = types.package;
      default = pkgs.callPackage ../../packages/helium-bin/package.nix { };
      defaultText = literalExpression "pkgs.callPackage ../../packages/helium-bin/package.nix { }";
      description = "The Helium package to install.";
    };

    finalPackage = mkOption {
      type = types.package;
      readOnly = true;
      description = "The Helium package with Home Manager command-line arguments applied.";
    };

    commandLineArgs = mkOption {
      type = types.listOf types.str;
      default = [ ];
      example = [ "--helium-update-channel=beta" ];
      description = "Command-line arguments passed to Helium on every launch.";
    };

    profileDirectory = mkOption {
      type = types.strMatching "[^./][^/]*";
      default = "Default";
      description = "Chromium profile directory whose Helium service preferences are managed.";
    };

    autoUpdate = mkOption {
      type = types.bool;
      default = false;
      description = ''
        Whether Helium may download browser and component updates itself.
        Keep this disabled when Nix manages the application version.
      '';
    };

    services = {
      enable = mkOption {
        type = types.bool;
        default = true;
        description = "Whether Helium may access its optional services.";
      };

      bangs = mkOption {
        type = types.bool;
        default = true;
        description = "Whether Helium may download and use the !bangs list.";
      };

      extensionProxy = mkOption {
        type = types.bool;
        default = true;
        description = "Whether Helium may proxy extension download requests through its services.";
      };

      spellcheck = mkOption {
        type = types.bool;
        default = true;
        description = "Whether Helium may download spellcheck dictionaries through its services.";
      };

      ublockAssets = mkOption {
        type = types.bool;
        default = true;
        description = "Whether Helium may download uBlock Origin filter lists through its services.";
      };

      origin = mkOption {
        type = types.nullOr types.str;
        default = null;
        example = "https://services.example.org";
        description = "Optional override for the Helium services origin.";
      };
    };

    extensions = mkOption {
      type = types.listOf (types.coercedTo types.str (id: { inherit id; }) extensionType);
      default = [ ];
      example = [ "cjpalhdlnbpafiamejdnhcphjbkeiagm" ];
      description = "Extensions to install in Helium.";
    };

    dictionaries = mkOption {
      type = types.listOf types.package;
      default = [ ];
      description = "Dictionaries to install in Helium.";
    };

    nativeMessagingHosts = mkOption {
      type = types.listOf types.package;
      default = [ ];
      description = "Native messaging host packages to make available to Helium.";
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = pkgs.stdenv.hostPlatform.isLinux || pkgs.stdenv.hostPlatform.isDarwin;
        message = "programs.helium is only supported on Linux and macOS.";
      }
      {
        assertion = builtins.all (ext: ext.crxPath != null -> ext.version != null) cfg.extensions;
        message = "programs.helium.extensions requires version when crxPath is set.";
      }
      {
        assertion = cfg.extensions == [ ] || (cfg.services.enable && cfg.services.extensionProxy);
        message = "programs.helium.extensions requires services.enable and services.extensionProxy.";
      }
    ];

    programs.helium.finalPackage =
      if cfg.commandLineArgs == [ ] then
        cfg.package
      else
        pkgs.symlinkJoin {
          name = "${(builtins.parseDrvName cfg.package.name).name}-wrapped";
          paths = [ cfg.package ];
          nativeBuildInputs = [ pkgs.makeWrapper ];
          postBuild = ''
            rm -f "$out/bin/helium"
            makeWrapper \
              "${lib.getExe cfg.package}" \
              "$out/bin/helium" \
              --add-flags ${lib.escapeShellArg (lib.escapeShellArgs cfg.commandLineArgs)}
            ${lib.optionalString pkgs.stdenv.hostPlatform.isLinux ''
              if [ -f "$out/share/applications/helium.desktop" ]; then
                cp --remove-destination "${cfg.package}/share/applications/helium.desktop" \
                  "$out/share/applications/helium.desktop"
                sed -i "s#^Exec=[^ ]*#Exec=$out/bin/helium#" \
                  "$out/share/applications/helium.desktop"
              fi
            ''}
          '';
        };

    home.packages = [ cfg.finalPackage ];

    home.file =
      lib.listToAttrs (map extensionJson cfg.extensions)
      // lib.listToAttrs (map dictionary cfg.dictionaries)
      // {
        "${configDirectory}/NativeMessagingHosts" = lib.mkIf (cfg.nativeMessagingHosts != [ ]) {
          source = "${nativeMessagingHosts}/etc/chromium/native-messaging-hosts";
          recursive = true;
        };
      };

    home.activation.heliumUpdatePreferences = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
      (
        preferencesDirectory=${lib.escapeShellArg "${configDirectory}/${cfg.profileDirectory}"}
        preferences="$preferencesDirectory/Preferences"
        heliumPreferences=${lib.escapeShellArg (builtins.toJSON heliumPreferences)}

        if [[ -v DRY_RUN ]]; then
          echo "Would update Helium preferences at '$preferences'"
          exit 0
        fi

        if [[ -L "$preferences" || ( -e "$preferences" && ! -f "$preferences" ) ]]; then
          errorEcho "Helium preferences must be a regular file, not a symlink: $preferences" >&2
          exit 1
        fi

        verboseEcho "Merging Helium preferences into '$preferences'"
        run ${pkgs.coreutils}/bin/mkdir -p "$preferencesDirectory"
        umask 077
        temporary="$(${pkgs.coreutils}/bin/mktemp "$preferencesDirectory/.Preferences.XXXXXX")"
        trap '${pkgs.coreutils}/bin/rm -f -- "$temporary"' EXIT

        if [[ -f "$preferences" ]]; then
          ${lib.getExe pkgs.jq} --slurp --argjson heliumPreferences "$heliumPreferences" \
            'if length == 1 and (.[0] | type) == "object"
             then .[0] * $heliumPreferences
             else error("Helium Preferences must contain one JSON object") end' \
            "$preferences" > "$temporary"
        else
          ${lib.getExe pkgs.jq} --null-input --argjson heliumPreferences "$heliumPreferences" \
            '$heliumPreferences' > "$temporary"
        fi

        if ! ${pkgs.diffutils}/bin/cmp -s -- "$temporary" "$preferences"; then
          run ${pkgs.coreutils}/bin/mv -f -- "$temporary" "$preferences"
        fi
      )
    '';
  };
}
