{
  config,
  lib,
  pkgs,
  ...
}:
let
  inherit (lib) literalExpression mkOption types;

  cfg = config.programs.helium;
  configDirectory = "Library/Application Support/net.imput.helium";
  heliumServicesOrigin =
    if cfg.services.origin == null then
      "https://services.helium.imput.net"
    else
      lib.removeSuffix "/" cfg.services.origin;
  heliumExtensionUpdateUrl = "${heliumServicesOrigin}/ext";
  preferences = "${config.home.homeDirectory}/${configDirectory}/${cfg.profileDirectory}/Preferences";
  heliumPreferences = {
    helium.services = {
      enabled = cfg.services.enable;
      bangs = cfg.services.bangs;
      ext_proxy = cfg.services.extensionProxy;
      spellcheck_files = cfg.services.spellcheck;
      origin_override = if cfg.services.origin == null then "" else cfg.services.origin;
      browser_updates = cfg.autoUpdate;
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
  wrapperFlags = lib.concatMapStringsSep " " lib.escapeShellArg (
    [ "--simulate-outdated-no-au=Tue, 31 Dec 2099 23:59:59 GMT" ] ++ cfg.commandLineArgs
  );
  wrapperArgs = "--add-flags ${lib.escapeShellArg wrapperFlags}";
in
{
  options.programs.helium = {
    enable = lib.mkEnableOption "Helium browser";

    package = mkOption {
      type = types.package;
      default = pkgs.callPackage ../../packages/helium { };
      defaultText = literalExpression "pkgs.callPackage ../../packages/helium { }";
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
        assertion = pkgs.stdenv.hostPlatform.isDarwin;
        message = "programs.helium is only supported on darwin.";
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
              "${cfg.package}/Applications/Helium.app/Contents/MacOS/Helium" \
              "$out/bin/helium" \
              ${wrapperArgs}
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
      preferences=${lib.escapeShellArg preferences}
      preferencesDirectory="$(/usr/bin/dirname "$preferences")"
      heliumPreferences=${lib.escapeShellArg (builtins.toJSON heliumPreferences)}

      if [ -e "$preferences" ] && [ ! -f "$preferences" ]; then
        echo "Helium preferences path is not a regular file: $preferences" >&2
        exit 1
      fi

      /bin/mkdir -p "$preferencesDirectory"
      temporary="$(/usr/bin/mktemp "$preferencesDirectory/.Preferences.XXXXXX")"
      /bin/chmod 600 "$temporary"

      if [ -f "$preferences" ]; then
        ${lib.getExe pkgs.jq} --argjson heliumPreferences "$heliumPreferences" \
          '. * $heliumPreferences' \
          "$preferences" > "$temporary"
      else
        printf '%s\n' "$heliumPreferences" > "$temporary"
      fi

      /bin/mv "$temporary" "$preferences"
    '';
  };
}
