{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.uuremote;

  agentLabel = "com.netease.uuremote.agent";
  daemonLabel = "com.netease.uuremote.daemon";
  appPath = "/Applications/UURemote.app";
  appSource = "${cfg.package}/Applications/UURemote.app";
  managedDirectory = "/Library/Application Support/com.github.9bingyin.nur-packages.uuremote";
  managedMarker = "${managedDirectory}/.managed-by-nix-uuremote";
  restartMarker = "${managedDirectory}/.restart-services";
  markerText = "managed by nix-darwin services.uuremote";
  helperPaths = [
    "Contents/XPCServices/UURemoteHelper.xpc/Contents/MacOS/UURemoteHelper"
    "Contents/Helpers/UURemoteUpdater.app/Contents/XPCServices/UURemoteHelper.xpc/Contents/MacOS/UURemoteHelper"
  ];

  cli = pkgs.writeShellApplication {
    name = "uuyc-cli";
    text = ''
      exec ${lib.escapeShellArg "${appPath}/Contents/Helpers/uuyc-cli"} "$@"
    '';
  };

  agentPlist = "${cfg.package}/Library/LaunchAgents/${agentLabel}.plist";
  daemonPlist = "${cfg.package}/Library/LaunchDaemons/${daemonLabel}.plist";
in
{
  options.services.uuremote = {
    enable = lib.mkEnableOption "NetEase UU Remote system integration";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ../../packages/uuremote { };
      defaultText = lib.literalExpression "pkgs.callPackage ../../packages/uuremote { }";
      description = "The UU Remote package whose signed app bundle and launchd plists are installed.";
    };
  };

  config = {
    assertions = lib.optionals cfg.enable [
      {
        assertion = pkgs.stdenv.hostPlatform.isDarwin;
        message = "services.uuremote is only supported on darwin";
      }
      {
        assertion = config.system.primaryUser != null;
        message = "services.uuremote requires system.primaryUser for its GUI LaunchAgent";
      }
    ];

    environment.systemPackages = lib.mkIf cfg.enable [ cli ];

    # Preserve the vendor plists verbatim. nix-darwin owns copying, reloading,
    # and removing these files across system generations.
    environment.launchAgents = lib.mkIf cfg.enable {
      "${agentLabel}.plist".source = agentPlist;
    };
    environment.launchDaemons = lib.mkIf cfg.enable {
      "${daemonLabel}.plist".source = daemonPlist;
    };

    # The vendor plists hard-code /Applications/UURemote.app. Keep a signed
    # entity copy there; adding files inside the bundle invalidates Gatekeeper.
    system.activationScripts.extraActivation.text = lib.mkAfter (
      if cfg.enable then
        ''
          echo "installing UU Remote app bundle..." >&2

          appSource=${lib.escapeShellArg appSource}
          appPath=${lib.escapeShellArg appPath}
          managedDirectory=${lib.escapeShellArg managedDirectory}
          managedMarker=${lib.escapeShellArg managedMarker}
          restartMarker=${lib.escapeShellArg restartMarker}
          markerText=${lib.escapeShellArg markerText}
          rsync=${lib.escapeShellArg (lib.getExe pkgs.rsync)}

          isManagedInstall() {
            [ -f "$managedMarker" ] && [ ! -L "$managedMarker" ] \
              && /usr/bin/grep -qxF "$markerText" "$managedMarker"
          }

          setHelperPermissions() {
            local relative_path="$1"
            local helper="$appPath/$relative_path"
            local helper_directory
            local metadata owner mode

            if [ -L "$helper" ] || [ ! -f "$helper" ]; then
              echo "invalid UU Remote helper: $helper" >&2
              exit 1
            fi
            helper_directory=$(dirname "$helper")
            metadata=$(/usr/bin/stat -f '%u:%Lp' "$helper_directory")
            owner=''${metadata%%:*}
            mode=''${metadata#*:}
            if [ "$owner" != 0 ] || (( (8#$mode & 022) != 0 )); then
              echo "insecure UU Remote helper directory: $helper_directory" >&2
              exit 1
            fi
            /usr/sbin/chown root:wheel "$helper"
            /bin/chmod 4755 "$helper"
          }

          /bin/mkdir -p /Applications "$managedDirectory"
          /usr/sbin/chown root:wheel "$managedDirectory"
          /bin/chmod 0755 "$managedDirectory"

          # Migrate the previous marker location before replacing the bundle.
          if [ -f "$appPath/.managed-by-nix-uuremote" ]; then
            /bin/chmod u+w "$appPath" 2>/dev/null || true
            /bin/rm -f "$appPath/.managed-by-nix-uuremote"
          fi

          changed=0
          if [ ! -d "$appPath" ] || [ -L "$appPath" ] || ! isManagedInstall; then
            changed=1
          else
            # Do not pipe this to `grep -q`: activation enables pipefail, and
            # grep closing early would make rsync fail with SIGPIPE (141).
            changeList=$("$rsync" -ani --delete --checksum \
              --no-perms --no-owner --no-group --no-times \
              "$appSource/" "$appPath/")
            if [ -n "$changeList" ]; then
              changed=1
            fi
          fi

          if [ "$changed" -eq 1 ]; then
            temporary="/Applications/.UURemote.app.new"
            previous="/Applications/.UURemote.app.previous"

            /bin/rm -rf "$temporary" "$previous"
            /bin/mkdir -p "$temporary"
            "$rsync" \
              --archive \
              --checksum \
              --delete \
              --copy-unsafe-links \
              --chmod=-w \
              --no-owner \
              --no-group \
              "$appSource/" "$temporary/"

            if [ -e "$appPath" ] || [ -L "$appPath" ]; then
              /bin/mv "$appPath" "$previous"
            fi
            /bin/mv "$temporary" "$appPath"
            /bin/rm -rf "$previous"

            printf '%s\n' "$markerText" > "$managedMarker"
            /usr/sbin/chown root:wheel "$managedMarker"
            /bin/chmod 0644 "$managedMarker"
            : > "$restartMarker"
            /usr/sbin/chown root:wheel "$restartMarker"
            /bin/chmod 0644 "$restartMarker"
          fi

          ${lib.concatMapStringsSep "\n" (
            path: "setHelperPermissions ${lib.escapeShellArg path}"
          ) helperPaths}
        ''
      else
        ''
          appPath=${lib.escapeShellArg appPath}
          managedDirectory=${lib.escapeShellArg managedDirectory}
          managedMarker=${lib.escapeShellArg managedMarker}
          markerText=${lib.escapeShellArg markerText}

          if [ -f "$managedMarker" ] && [ ! -L "$managedMarker" ] \
            && /usr/bin/grep -qxF "$markerText" "$managedMarker"; then
            /bin/chmod -R u+w "$appPath" 2>/dev/null || true
            /bin/rm -rf "$appPath" "$managedDirectory"
          fi
        ''
    );

    # Run after nix-darwin has declaratively reloaded the vendor plists.
    system.activationScripts.postActivation.text = lib.mkAfter (
      lib.optionalString cfg.enable ''
        restartMarker=${lib.escapeShellArg restartMarker}
        if [ -f "$restartMarker" ] && [ ! -L "$restartMarker" ]; then
          /bin/launchctl kickstart -k "system/${daemonLabel}" 2>/dev/null || true
          /bin/launchctl kickstart -k "gui/$(/usr/bin/id -u ${lib.escapeShellArg config.system.primaryUser})/${agentLabel}" 2>/dev/null || true
          /bin/rm -f "$restartMarker"
        fi
      ''
    );
  };
}
