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
  agentPlist = "/Library/LaunchAgents/${agentLabel}.plist";
  daemonPlist = "/Library/LaunchDaemons/${daemonLabel}.plist";
  appPath = "/Applications/UURemote.app";
  helperMain = "${appPath}/Contents/XPCServices/UURemoteHelper.xpc/Contents/MacOS/UURemoteHelper";
  helperUpdater = "${appPath}/Contents/Helpers/UURemoteUpdater.app/Contents/XPCServices/UURemoteHelper.xpc/Contents/MacOS/UURemoteHelper";
  cliSource = "${appPath}/Contents/Helpers/uuyc-cli";
  cliTarget = "/usr/local/bin/uuyc-cli";
  managedMarker = "${appPath}/.managed-by-nix-uuremote";
  markerText = "managed by nix-darwin services.uuremote";
  rsync = lib.getExe pkgs.rsync;
  cmp = lib.getExe' pkgs.diffutils "cmp";
in
{
  options.services.uuremote = {
    enable = lib.mkEnableOption "NetEase UU Remote system integration";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ../../packages/uuremote { };
      defaultText = lib.literalExpression "pkgs.callPackage ../../packages/uuremote { }";
      description = "The UU Remote package whose app bundle and launchd plists are installed.";
    };

    addToSystemPackages = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Add the package to environment.systemPackages so CLI wrappers from the
        Nix store remain available in PATH.
      '';
    };

    openOnActivation = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        Open UU Remote after activation, matching the official installer
        postinstall behaviour. Disabled by default for non-interactive rebuilds.
      '';
    };
  };

  config = {
    assertions = lib.optionals cfg.enable [
      {
        assertion = pkgs.stdenv.hostPlatform.isDarwin;
        message = "services.uuremote is only supported on darwin";
      }
    ];

    environment.systemPackages = lib.mkIf (cfg.enable && cfg.addToSystemPackages) [ cfg.package ];

    system.activationScripts.extraActivation.text = lib.mkAfter (
      if cfg.enable then
        ''
          echo "setting up UU Remote..." >&2

          package=${lib.escapeShellArg cfg.package}
          appPath=${lib.escapeShellArg appPath}
          agentPlist=${lib.escapeShellArg agentPlist}
          daemonPlist=${lib.escapeShellArg daemonPlist}
          agentLabel=${lib.escapeShellArg agentLabel}
          daemonLabel=${lib.escapeShellArg daemonLabel}
          helperMain=${lib.escapeShellArg helperMain}
          helperUpdater=${lib.escapeShellArg helperUpdater}
          cliSource=${lib.escapeShellArg cliSource}
          cliTarget=${lib.escapeShellArg cliTarget}
          managedMarker=${lib.escapeShellArg managedMarker}
          markerText=${lib.escapeShellArg markerText}
          rsync=${lib.escapeShellArg rsync}
          cmp=${lib.escapeShellArg cmp}

          getConsoleUser() {
            local console_user
            console_user=$(/usr/sbin/scutil <<< "show State:/Users/ConsoleUser" | /usr/bin/awk '/Name :/ && ! /loginwindow/ { print $3 }')
            if [ -z "$console_user" ] || [ "$console_user" = "root" ]; then
              console_user=$(/usr/bin/stat -f '%Su' /dev/console 2>/dev/null || true)
            fi
            if [ -z "$console_user" ] || [ "$console_user" = "root" ]; then
              console_user=$(/usr/bin/who | /usr/bin/awk '/console/ { print $1; exit }')
            fi
            printf '%s\n' "$console_user"
          }

          isManagedInstall() {
            [ -f "$managedMarker" ] && [ ! -L "$managedMarker" ] \
              && /usr/bin/grep -qxF "$markerText" "$managedMarker"
          }

          stopService() {
            local domain="$1"
            local label="$2"
            local plist="$3"

            if [ -f "$plist" ]; then
              /bin/launchctl bootout "$domain" "$plist" 2>/dev/null || true
            fi
            /bin/launchctl bootout "$domain/$label" 2>/dev/null || true
          }

          startService() {
            local domain="$1"
            local label="$2"
            local plist="$3"

            /usr/sbin/chown root:wheel "$plist"
            /bin/chmod 644 "$plist"
            /bin/launchctl enable "$domain/$label" 2>/dev/null || true
            /bin/launchctl bootstrap "$domain" "$plist"
          }

          setHelperPermissions() {
            local helper_path="$1"
            if [ -f "$helper_path" ]; then
              /usr/sbin/chown root:wheel "$helper_path"
              /bin/chmod 4755 "$helper_path"
            fi
          }

          currentUser=$(getConsoleUser)
          currentUid=""
          if [ -n "$currentUser" ] && [ "$currentUser" != "root" ]; then
            currentUid=$(/usr/bin/id -u "$currentUser" 2>/dev/null || true)
          fi

          /bin/mkdir -p /Applications /Library/LaunchAgents /Library/LaunchDaemons /usr/local/bin

          needsUpdate=0
          if [ ! -d "$appPath" ] || [ -L "$appPath" ] || ! isManagedInstall; then
            needsUpdate=1
          elif ! "$rsync" -ani --delete --checksum \
            "$package/Applications/UURemote.app/" "$appPath/" | /usr/bin/grep -q .; then
            :
          else
            needsUpdate=1
          fi

          if [ ! -f "$agentPlist" ] || ! "$cmp" -s \
            "$package/Library/LaunchAgents/$agentLabel.plist" "$agentPlist"; then
            needsUpdate=1
          fi
          if [ ! -f "$daemonPlist" ] || ! "$cmp" -s \
            "$package/Library/LaunchDaemons/$daemonLabel.plist" "$daemonPlist"; then
            needsUpdate=1
          fi

          if [ "$needsUpdate" -eq 1 ]; then
            stopService system "$daemonLabel" "$daemonPlist"
            if [ -n "$currentUid" ]; then
              stopService "gui/$currentUid" "$agentLabel" "$agentPlist"
            fi

            if [ -L "$appPath" ]; then
              /bin/rm "$appPath"
            fi
            if [ -e "$appPath" ]; then
              /bin/chmod -R u+w "$appPath" 2>/dev/null || true
            fi
            /bin/mkdir -p "$appPath"
            "$rsync" \
              --archive \
              --checksum \
              --delete \
              --copy-unsafe-links \
              --chmod=-w \
              --no-owner \
              --no-group \
              "$package/Applications/UURemote.app/" "$appPath/"

            printf '%s\n' "$markerText" > "$managedMarker"
            /usr/sbin/chown root:wheel "$managedMarker"
            /bin/chmod 0644 "$managedMarker"

            /bin/cp "$package/Library/LaunchAgents/$agentLabel.plist" "$agentPlist"
            /bin/cp "$package/Library/LaunchDaemons/$daemonLabel.plist" "$daemonPlist"
          fi

          # Official postinstall always enforces these privileges.
          setHelperPermissions "$helperMain"
          setHelperPermissions "$helperUpdater"

          if [ -n "$currentUid" ]; then
            oldUserAgent="/Users/$currentUser/Library/LaunchAgents/com.netease.uuremote.plist"
            if [ -f "$oldUserAgent" ]; then
              /bin/launchctl bootout "gui/$currentUid" "$oldUserAgent" 2>/dev/null || true
              /bin/rm -f "$oldUserAgent"
            fi
          fi

          /bin/rm -f /usr/local/bin/uuremote
          /bin/ln -sfn "$cliSource" "$cliTarget"

          if [ -n "$currentUid" ]; then
            if ! /bin/launchctl print "gui/$currentUid/$agentLabel" >/dev/null 2>&1 \
              || [ "$needsUpdate" -eq 1 ]; then
              startService "gui/$currentUid" "$agentLabel" "$agentPlist"
            fi
          else
            echo "no console user; skipping UU Remote LaunchAgent bootstrap" >&2
            /usr/sbin/chown root:wheel "$agentPlist"
            /bin/chmod 644 "$agentPlist"
          fi

          if ! /bin/launchctl print "system/$daemonLabel" >/dev/null 2>&1 \
            || [ "$needsUpdate" -eq 1 ]; then
            startService system "$daemonLabel" "$daemonPlist"
          fi

          ${lib.optionalString cfg.openOnActivation ''
            if [ -n "$currentUid" ] && [ -n "$currentUser" ]; then
              /bin/launchctl asuser "$currentUid" /usr/bin/sudo -u "$currentUser" \
                /usr/bin/open -b com.netease.uuremote --args -startup-by-installer \
                >/dev/null 2>&1 || true
            fi
          ''}
        ''
      else
        ''
          echo "removing managed UU Remote integration..." >&2

          appPath=${lib.escapeShellArg appPath}
          agentPlist=${lib.escapeShellArg agentPlist}
          daemonPlist=${lib.escapeShellArg daemonPlist}
          agentLabel=${lib.escapeShellArg agentLabel}
          daemonLabel=${lib.escapeShellArg daemonLabel}
          cliTarget=${lib.escapeShellArg cliTarget}
          managedMarker=${lib.escapeShellArg managedMarker}
          markerText=${lib.escapeShellArg markerText}

          getConsoleUser() {
            local console_user
            console_user=$(/usr/sbin/scutil <<< "show State:/Users/ConsoleUser" | /usr/bin/awk '/Name :/ && ! /loginwindow/ { print $3 }')
            if [ -z "$console_user" ] || [ "$console_user" = "root" ]; then
              console_user=$(/usr/bin/stat -f '%Su' /dev/console 2>/dev/null || true)
            fi
            if [ -z "$console_user" ] || [ "$console_user" = "root" ]; then
              console_user=$(/usr/bin/who | /usr/bin/awk '/console/ { print $1; exit }')
            fi
            printf '%s\n' "$console_user"
          }

          isManagedInstall() {
            [ -f "$managedMarker" ] && [ ! -L "$managedMarker" ] \
              && /usr/bin/grep -qxF "$markerText" "$managedMarker"
          }

          if ! isManagedInstall; then
            exit 0
          fi

          currentUser=$(getConsoleUser)
          currentUid=""
          if [ -n "$currentUser" ] && [ "$currentUser" != "root" ]; then
            currentUid=$(/usr/bin/id -u "$currentUser" 2>/dev/null || true)
          fi

          if [ -f "$daemonPlist" ]; then
            /bin/launchctl bootout system "$daemonPlist" 2>/dev/null || true
          fi
          /bin/launchctl bootout "system/$daemonLabel" 2>/dev/null || true
          if [ -n "$currentUid" ]; then
            if [ -f "$agentPlist" ]; then
              /bin/launchctl bootout "gui/$currentUid" "$agentPlist" 2>/dev/null || true
            fi
            /bin/launchctl bootout "gui/$currentUid/$agentLabel" 2>/dev/null || true
          fi

          /bin/rm -f "$agentPlist" "$daemonPlist"
          if [ -L "$cliTarget" ]; then
            /bin/rm -f "$cliTarget"
          fi
          /bin/rm -f /usr/local/bin/uuremote
          /bin/chmod -R u+w "$appPath" 2>/dev/null || true
          /bin/rm -rf "$appPath"
        ''
    );
  };
}
