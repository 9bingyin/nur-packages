{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.mihomo-warp;
  stateDir = "/var/lib/mihomo-warp";
  seedConfigFile = "${stateDir}/seed.yaml";
  configFile = "${stateDir}/config.yaml";
  registrationStateFile = "${stateDir}/registration-state";
  needsPrivilegedPort = cfg.port < 1024;
  dnsServers =
    let
      raw = lib.filter (s: s != "") (lib.splitString "," cfg.dns);
    in
    if raw == [ ] then
      [
        "1.1.1.1"
        "1.0.0.1"
      ]
    else
      raw;
  registrationScope = builtins.toJSON {
    mode = cfg.mode;
    deviceName = cfg.deviceName;
  };

  registerArgs = [
    "register"
    cfg.mode
    "-o"
    seedConfigFile
  ]
  ++ lib.optionals (cfg.deviceName != null) [
    "--name"
    cfg.deviceName
  ];

  registerScript = pkgs.writeShellScript "mihomo-warp-register" ''
    set -euo pipefail
    umask 0077

    state_file=${lib.escapeShellArg registrationStateFile}
    seed_file=${lib.escapeShellArg seedConfigFile}
    registration_scope=${lib.escapeShellArg registrationScope}

    jwt_hash=""
    if [ -n "''${WARP_JWT:-}" ]; then
      jwt_hash="$(printf '%s' "$WARP_JWT" | ${pkgs.coreutils}/bin/sha256sum | ${pkgs.coreutils}/bin/cut -d' ' -f1)"
    fi

    desired_hash="$(printf '%s\n%s\n' "$registration_scope" "$jwt_hash" | ${pkgs.coreutils}/bin/sha256sum | ${pkgs.coreutils}/bin/cut -d' ' -f1)"
    current_hash=""
    if [ -s "$state_file" ]; then
      current_hash="$(${pkgs.coreutils}/bin/cat "$state_file")"
    fi

    if [ ! -s "$seed_file" ] || [ "$current_hash" != "$desired_hash" ]; then
      args=(${lib.escapeShellArgs registerArgs})
      if [ -n "''${WARP_JWT:-}" ]; then
        args+=(--jwt "$WARP_JWT")
      fi
      ${cfg.package}/bin/mihomo-warp "''${args[@]}"
      printf '%s\n' "$desired_hash" > "$state_file"
      ${pkgs.coreutils}/bin/chmod 0600 "$state_file"
    fi
  '';

  renderScript = pkgs.writeShellScript "mihomo-warp-render" ''
    set -euo pipefail
    umask 0077

    seed_file=${lib.escapeShellArg seedConfigFile}
    output_file=${lib.escapeShellArg configFile}
    tmp_file="''${output_file}.tmp"

    if [ ! -s "$seed_file" ]; then
      echo "seed config is missing: $seed_file" >&2
      exit 1
    fi

    ${pkgs.coreutils}/bin/cp "$seed_file" "$tmp_file"
    trap '${pkgs.coreutils}/bin/rm -f "$tmp_file"' EXIT

    LISTEN_ADDR=${lib.escapeShellArg cfg.listen} \
      ${pkgs.yq-go}/bin/yq -i '.listeners[0].listen = strenv(LISTEN_ADDR)' "$tmp_file"
    LISTEN_PORT=${lib.escapeShellArg (toString cfg.port)} \
      ${pkgs.yq-go}/bin/yq -i '.listeners[0].port = (strenv(LISTEN_PORT) | tonumber)' "$tmp_file"

    ${pkgs.yq-go}/bin/yq -i '.proxies[0].dns = []' "$tmp_file"
    for dns_server in ${lib.escapeShellArgs dnsServers}; do
      DNS_SERVER="$dns_server" \
        ${pkgs.yq-go}/bin/yq -i '.proxies[0].dns += [strenv(DNS_SERVER)]' "$tmp_file"
    done

    if [ -n "''${SOCKS_USER:-}" ] && [ -n "''${SOCKS_PASS:-}" ]; then
      SOCKS_USER_VALUE="$SOCKS_USER" SOCKS_PASS_VALUE="$SOCKS_PASS" \
        ${pkgs.yq-go}/bin/yq -i '.listeners[0].users = [{"username": strenv(SOCKS_USER_VALUE), "password": strenv(SOCKS_PASS_VALUE)}]' "$tmp_file"
    else
      ${pkgs.yq-go}/bin/yq -i 'del(.listeners[0].users)' "$tmp_file"
    fi

    ${pkgs.coreutils}/bin/mv "$tmp_file" "$output_file"
    ${pkgs.coreutils}/bin/chmod 0600 "$output_file"
  '';

  commonHardening = {
    LockPersonality = true;
    NoNewPrivileges = true;
    PrivateDevices = true;
    PrivateTmp = true;
    ProtectClock = true;
    ProtectControlGroups = true;
    ProtectHome = true;
    ProtectHostname = true;
    ProtectKernelLogs = true;
    ProtectKernelModules = true;
    ProtectKernelTunables = true;
    ProtectSystem = "strict";
    ReadWritePaths = [ stateDir ];
    RestrictNamespaces = true;
    RestrictRealtime = true;
    RestrictSUIDSGID = true;
  };
in
{
  options.services.mihomo-warp = {
    enable = lib.mkEnableOption "Cloudflare WARP proxy";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ../pkgs/warp { };
      description = "The mihomo-warp package to use.";
    };

    mihomoPackage = lib.mkPackageOption pkgs "mihomo" { };

    mode = lib.mkOption {
      type = lib.types.enum [
        "masque"
        "wireguard"
      ];
      default = "masque";
      description = "WARP registration mode.";
    };

    listen = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "SOCKS5 listener bind address.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 1080;
      description = "SOCKS5 listener port.";
    };

    dns = lib.mkOption {
      type = lib.types.str;
      default = "1.1.1.1,1.0.0.1";
      description = "Comma-separated DNS servers.";
    };

    deviceName = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Device name for registration (masque mode only).";
    };

    environmentFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      description = ''
        Path to an environment file loaded by the systemd service.
        Supports the following variables:
        - WARP_JWT: ZeroTrust JWT token
        - SOCKS_USER: SOCKS5 authentication username
        - SOCKS_PASS: SOCKS5 authentication password
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    users.users.mihomo-warp = {
      isSystemUser = true;
      group = "mihomo-warp";
    };
    users.groups.mihomo-warp = { };

    systemd.services.mihomo-warp-register = {
      description = "Cloudflare WARP Device Registration";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      requiredBy = [ "mihomo-warp-render.service" ];
      before = [ "mihomo-warp-render.service" ];

      serviceConfig = commonHardening // {
        Type = "oneshot";
        User = "mihomo-warp";
        Group = "mihomo-warp";
        StateDirectory = "mihomo-warp";
        StateDirectoryMode = "0700";
        UMask = "0077";
        ExecStart = registerScript;
        EnvironmentFile = lib.mkIf (cfg.environmentFile != null) cfg.environmentFile;
        CapabilityBoundingSet = "";
      };
    };

    systemd.services.mihomo-warp-render = {
      description = "Cloudflare WARP Config Render";
      after = [ "mihomo-warp-register.service" ];
      requires = [ "mihomo-warp-register.service" ];
      requiredBy = [ "mihomo-warp.service" ];
      before = [ "mihomo-warp.service" ];

      serviceConfig = commonHardening // {
        Type = "oneshot";
        User = "mihomo-warp";
        Group = "mihomo-warp";
        StateDirectory = "mihomo-warp";
        StateDirectoryMode = "0700";
        UMask = "0077";
        ExecStart = renderScript;
        EnvironmentFile = lib.mkIf (cfg.environmentFile != null) cfg.environmentFile;
        CapabilityBoundingSet = "";
      };
    };

    systemd.services.mihomo-warp = {
      description = "Cloudflare WARP Proxy (mihomo)";
      after = [
        "network-online.target"
        "mihomo-warp-render.service"
      ];
      wants = [ "network-online.target" ];
      requires = [ "mihomo-warp-render.service" ];
      wantedBy = [ "multi-user.target" ];

      serviceConfig = commonHardening // {
        Type = "simple";
        User = "mihomo-warp";
        Group = "mihomo-warp";
        StateDirectory = "mihomo-warp";
        StateDirectoryMode = "0700";
        UMask = "0077";
        ExecStart = "${cfg.mihomoPackage}/bin/mihomo -d ${stateDir}";
        Restart = "on-failure";
        RestartSec = 5;
        CapabilityBoundingSet = lib.optionals needsPrivilegedPort [ "CAP_NET_BIND_SERVICE" ];
        AmbientCapabilities = lib.optionals needsPrivilegedPort [ "CAP_NET_BIND_SERVICE" ];
      };
    };
  };
}
