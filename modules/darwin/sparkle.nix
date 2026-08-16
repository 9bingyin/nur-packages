{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.sparkle;
  appSource = "${cfg.package}/Applications/Sparkle.app";
  appPath = "/Applications/Sparkle.app";
  sidecarDirectory = "${appPath}/Contents/Resources/sidecar";
  marker = "${appPath}/Contents/Resources/.managed-by-nix-sparkle";
  markerText = "managed by nix-darwin services.sparkle";
  rsync = lib.getExe pkgs.rsync;

  cli = pkgs.writeShellScriptBin "sparkle" ''
    exec ${lib.escapeShellArg "${appPath}/Contents/MacOS/Sparkle"} "$@"
  '';

  shellBindings = ''
    appSource=${lib.escapeShellArg appSource}
    appPath=${lib.escapeShellArg appPath}
    sidecarDirectory=${lib.escapeShellArg sidecarDirectory}
    marker=${lib.escapeShellArg marker}
    markerText=${lib.escapeShellArg markerText}
    rsync=${lib.escapeShellArg rsync}

    isManagedApp() {
      [ -f "$marker" ] && [ ! -L "$marker" ] \
        && /usr/bin/grep -qxF "$markerText" "$marker"
    }

    writeManagedMarker() {
      local markerPath="$1"
      local directory temporary
      directory=$(/usr/bin/dirname "$markerPath")
      if [ -L "$directory" ] || [ ! -d "$directory" ]; then
        echo "invalid Sparkle marker directory: $directory" >&2
        exit 1
      fi
      if [ -L "$markerPath" ]; then
        echo "refusing symbolic link in Sparkle marker path: $markerPath" >&2
        exit 1
      fi
      /bin/chmod u+w "$directory" 2>/dev/null || true
      temporary="$markerPath.new"
      if [ -L "$temporary" ] || { [ -e "$temporary" ] && [ ! -f "$temporary" ]; }; then
        echo "invalid Sparkle marker temporary path: $temporary" >&2
        exit 1
      fi
      /bin/rm -f "$temporary"
      printf '%s\n' "$markerText" > "$temporary"
      /usr/sbin/chown root:wheel "$temporary"
      /bin/chmod 0644 "$temporary"
      /bin/mv -f "$temporary" "$markerPath"
    }
  '';
in
{
  options.services.sparkle = {
    enable = lib.mkEnableOption "Sparkle privileged built-in Mihomo cores";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ../../packages/sparkle/package.nix { };
      defaultText = lib.literalExpression "pkgs.callPackage ../../packages/sparkle/package.nix { }";
      description = ''
        Sparkle package copied to /Applications. The module then grants TUN
        permissions on the original sidecar cores inside that app copy.
      '';
    };

    addToSystemPackages = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        Add a sparkle command that launches /Applications/Sparkle.app.
      '';
    };
  };

  config = {
    assertions = lib.optionals cfg.enable [
      {
        assertion = pkgs.stdenv.hostPlatform.isDarwin;
        message = "services.sparkle is only supported on darwin";
      }
    ];

    environment.systemPackages = lib.mkIf (cfg.enable && cfg.addToSystemPackages) [ cli ];

    system.activationScripts.extraActivation.text = lib.mkAfter (
      if cfg.enable then
        ''
          echo "installing Sparkle built-in Mihomo cores..." >&2

          ${shellBindings}

          if [ -L /Applications ] || [ ! -d /Applications ]; then
            echo "invalid Applications directory" >&2
            exit 1
          fi
          if [ -e "$appPath" ] || [ -L "$appPath" ]; then
            if ! isManagedApp; then
              echo "refusing to replace unmanaged Sparkle app: $appPath" >&2
              exit 1
            fi
          fi

          changed=0
          if [ ! -d "$appPath" ] || [ -L "$appPath" ] || ! isManagedApp; then
            changed=1
          else
            changeList=$("$rsync" -ani --delete --checksum \
              --no-perms --no-owner --no-group --no-times \
              --exclude '.managed-by-nix-sparkle' \
              "$appSource/" "$appPath/")
            if [ -n "$changeList" ]; then
              changed=1
            fi
          fi

          if [ "$changed" -eq 1 ]; then
            staging=$(/usr/bin/mktemp -d /private/var/tmp/sparkle.XXXXXX)
            "$rsync" \
              --archive \
              --checksum \
              --delete \
              --copy-unsafe-links \
              --chmod=-w \
              --no-owner \
              --no-group \
              "$appSource/" "$staging/Sparkle.app/"
            writeManagedMarker "$staging/Sparkle.app/Contents/Resources/.managed-by-nix-sparkle"

            if [ -e "$appPath" ] || [ -L "$appPath" ]; then
              /bin/mv "$appPath" "$staging/previous.app"
            fi
            /bin/mv "$staging/Sparkle.app" "$appPath"
            /bin/rm -rf "$staging"
          fi

          if [ -L "$sidecarDirectory" ] || [ ! -d "$sidecarDirectory" ]; then
            echo "invalid Sparkle sidecar directory: $sidecarDirectory" >&2
            exit 1
          fi
          sidecarMetadata=$(/usr/bin/stat -f '%u:%Lp' "$sidecarDirectory")
          sidecarOwner=''${sidecarMetadata%%:*}
          sidecarMode=''${sidecarMetadata#*:}
          if [ "$sidecarOwner" != 0 ] || (( (8#$sidecarMode & 022) != 0 )); then
            echo "insecure Sparkle sidecar directory: $sidecarDirectory" >&2
            exit 1
          fi

          for core in mihomo mihomo-alpha; do
            target="$sidecarDirectory/$core"
            if [ -L "$target" ] || [ ! -f "$target" ]; then
              echo "missing Sparkle built-in core: $target" >&2
              exit 1
            fi
            /usr/bin/codesign --verify --strict "$target"
            /usr/sbin/chown root:admin "$target"
            /bin/chmod 4755 "$target"
          done

          writeManagedMarker "$marker"
        ''
      else
        ''
          ${shellBindings}

          if isManagedApp; then
            /bin/chmod -R u+w "$appPath" 2>/dev/null || true
            /bin/rm -rf "$appPath"
          fi
        ''
    );
  };
}
