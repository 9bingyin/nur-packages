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

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = pkgs.stdenv.hostPlatform.isDarwin;
        message = "services.uuremote is only supported on darwin";
      }
    ];

    environment.systemPackages = lib.mkIf cfg.addToSystemPackages [ cfg.package ];

    system.activationScripts.extraActivation.text = lib.mkAfter ''
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
      rsync=${lib.escapeShellArg (lib.getExe pkgs.rsync)}

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

      stopService system "$daemonLabel" "$daemonPlist"
      if [ -n "$currentUid" ]; then
        stopService "gui/$currentUid" "$agentLabel" "$agentPlist"
        oldUserAgent="/Users/$currentUser/Library/LaunchAgents/com.netease.uuremote.plist"
        if [ -f "$oldUserAgent" ]; then
          /bin/launchctl bootout "gui/$currentUid" "$oldUserAgent" 2>/dev/null || true
          /bin/rm -f "$oldUserAgent"
        fi
      fi

      /bin/mkdir -p /Applications /Library/LaunchAgents /Library/LaunchDaemons /usr/local/bin

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
      printf '%s\n' 'managed by nix-darwin services.uuremote' > "$managedMarker"
      /usr/sbin/chown root:wheel "$managedMarker"
      /bin/chmod 0644 "$managedMarker"

      /bin/cp "$package/Library/LaunchAgents/${agentLabel}.plist" "$agentPlist"
      /bin/cp "$package/Library/LaunchDaemons/${daemonLabel}.plist" "$daemonPlist"

      setHelperPermissions "$helperMain"
      setHelperPermissions "$helperUpdater"

      /bin/rm -f /usr/local/bin/uuremote
      /bin/ln -sfn "$cliSource" "$cliTarget"

      if [ -n "$currentUid" ]; then
        startService "gui/$currentUid" "$agentLabel" "$agentPlist"
      else
        echo "no console user; skipping UU Remote LaunchAgent bootstrap" >&2
        /usr/sbin/chown root:wheel "$agentPlist"
        /bin/chmod 644 "$agentPlist"
      fi
      startService system "$daemonLabel" "$daemonPlist"

      ${lib.optionalString cfg.openOnActivation ''
        if [ -n "$currentUid" ] && [ -n "$currentUser" ]; then
          /bin/launchctl asuser "$currentUid" /usr/bin/sudo -u "$currentUser" \
            /usr/bin/open -b com.netease.uuremote --args -startup-by-installer \
            >/dev/null 2>&1 || true
        fi
      ''}
    '';
  };
}
