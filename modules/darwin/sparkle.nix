{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.sparkle;
  managedDirectory = "/Library/Nix/Sparkle";
  sidecarDirectory = "${managedDirectory}/sidecar";
  marker = "${managedDirectory}/.managed-by-nix-sparkle";
  sourceDirectory = "${cfg.package}/Applications/Sparkle.app/Contents/Resources/sidecar";
  install = lib.getExe' pkgs.coreutils "install";
  cmp = lib.getExe' pkgs.diffutils "cmp";
in
{
  options.services.sparkle = {
    enable = lib.mkEnableOption "Sparkle privileged built-in Mihomo cores";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ../../packages/sparkle { };
      defaultText = lib.literalExpression "pkgs.callPackage ../../packages/sparkle { }";
      description = ''
        Sparkle package whose built-in Mihomo cores are installed with the
        permissions needed for TUN mode. Set this to the same package installed
        through Home Manager when applicable.
      '';
    };

    addToSystemPackages = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        Add Sparkle to environment.systemPackages. This defaults to false so
        Home Manager can install the application without a duplicate system
        package.
      '';
    };
  };

  config = {
    environment.systemPackages = lib.mkIf (cfg.enable && cfg.addToSystemPackages) [ cfg.package ];

    system.activationScripts.extraActivation.text = lib.mkAfter (
      if cfg.enable then
        ''
          echo "installing Sparkle built-in Mihomo cores..." >&2

          sourceDirectory=${lib.escapeShellArg sourceDirectory}
          managedDirectory=${lib.escapeShellArg managedDirectory}
          sidecarDirectory=${lib.escapeShellArg sidecarDirectory}
          marker=${lib.escapeShellArg marker}

          ensureSecureDirectory() {
            local directory="$1"
            local metadata owner group mode

            if [ -L "$directory" ]; then
              echo "refusing symbolic link in Sparkle core path: $directory" >&2
              exit 1
            fi

            ${install} -d -o root -g wheel -m 0755 "$directory"
            metadata=$(/usr/bin/stat -f '%u:%g:%Lp' "$directory")
            owner=''${metadata%%:*}
            metadata=''${metadata#*:}
            group=''${metadata%%:*}
            mode=''${metadata#*:}
            if [ "$owner" != 0 ] || [ "$group" != 0 ] || (( (8#$mode & 022) != 0 )); then
              echo "insecure Sparkle core directory: $directory" >&2
              exit 1
            fi
          }

          ensureSecureDirectory /Library/Nix
          ensureSecureDirectory "$managedDirectory"
          ensureSecureDirectory "$sidecarDirectory"
          if [ -L "$marker" ]; then
            echo "refusing symbolic link in Sparkle marker path: $marker" >&2
            exit 1
          fi
          printf '%s\n' 'managed by nix-darwin services.sparkle' > "$marker"
          chown root:wheel "$marker"
          chmod 0644 "$marker"

          for core in mihomo mihomo-alpha; do
            source="$sourceDirectory/$core"
            target="$sidecarDirectory/$core"
            temporary="$sidecarDirectory/.$core.new"

            if [ ! -f "$source" ]; then
              echo "missing Sparkle built-in core: $source" >&2
              exit 1
            fi
            if [ -L "$target" ] || { [ -e "$target" ] && [ ! -f "$target" ]; }; then
              echo "invalid Sparkle core target: $target" >&2
              exit 1
            fi

            if [ ! -f "$target" ] || ! ${cmp} -s "$source" "$target"; then
              rm -f "$temporary"
              ${install} -o root -g wheel -m 0755 "$source" "$temporary"
              /usr/bin/codesign --verify --strict "$temporary"
              chmod 4755 "$temporary"
              mv -f "$temporary" "$target"
            fi

            chown root:wheel "$target"
            chmod 4755 "$target"
          done
        ''
      else
        ''
          managedDirectory=${lib.escapeShellArg managedDirectory}
          marker=${lib.escapeShellArg marker}

          if [ -d "$managedDirectory" ] && [ ! -L "$managedDirectory" ] \
            && [ -f "$marker" ] && [ ! -L "$marker" ] \
            && grep -qxF 'managed by nix-darwin services.sparkle' "$marker"; then
            rm -rf "$managedDirectory"
          fi
        ''
    );
  };
}
