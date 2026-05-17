{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.usque;
  usqueExe = lib.getExe cfg.package;
  stateDir = "/var/lib/usque";
  configFile = "${stateDir}/config.json";
  registrationStateFile = "${stateDir}/registration-state";
  proxyModes = [
    "socks"
    "http-proxy"
  ];
  netstackModes = proxyModes ++ [ "portfw" ];
  needsPrivilegedPort = cfg.port < 1024 && builtins.elem cfg.mode proxyModes;
  needsTun = cfg.mode == "nativetun";
  dnsServers =
    let
      raw = lib.filter (s: s != "") (lib.splitString "," cfg.dns);
    in
    if raw == [ ] then
      [
        "9.9.9.9"
        "149.112.112.112"
        "2620:fe::fe"
        "2620:fe::9"
      ]
    else
      raw;
  registrationScope = builtins.toJSON {
    acceptTerms = cfg.acceptTerms;
    deviceName = cfg.deviceName;
    locale = cfg.locale;
    model = cfg.model;
  };

  registerArgs = [
    "-c"
    configFile
    "register"
    "--locale"
    cfg.locale
    "--model"
    cfg.model
  ]
  ++ lib.optionals cfg.acceptTerms [ "--accept-tos" ]
  ++ lib.optionals (cfg.deviceName != null) [
    "--name"
    cfg.deviceName
  ];

  serviceArgs = [
    "-c"
    configFile
    cfg.mode
  ]
  ++ lib.optionals (builtins.elem cfg.mode proxyModes) [
    "--bind"
    cfg.listen
    "--port"
    (toString cfg.port)
  ]
  ++ lib.optionals (builtins.elem cfg.mode netstackModes) (
    lib.concatMap (dns: [
      "--dns"
      dns
    ]) dnsServers
  )
  ++ lib.optionals (cfg.mode == "socks") [
    "--udp-timeout"
    cfg.udpTimeout
  ]
  ++ lib.optionals (cfg.mode == "nativetun" && cfg.interfaceName != null) [
    "--interface-name"
    cfg.interfaceName
  ]
  ++ lib.optionals (cfg.mode == "nativetun" && cfg.noIproute2) [ "--no-iproute2" ]
  ++ lib.optionals (cfg.mode == "nativetun" && cfg.persist) [ "--persist" ]
  ++ lib.optionals (cfg.mode == "portfw") (
    (lib.concatMap (mapping: [
      "--local-ports"
      mapping
    ]) cfg.localPorts)
    ++ (lib.concatMap (mapping: [
      "--remote-ports"
      mapping
    ]) cfg.remotePorts)
  )
  ++ [
    "--connect-port"
    (toString cfg.connectPort)
    "--sni-address"
    cfg.sni
    "--keepalive-period"
    cfg.keepalivePeriod
    "--mtu"
    (toString cfg.mtu)
    "--reconnect-delay"
    cfg.reconnectDelay
  ]
  ++ lib.optionals (cfg.initialPacketSize != null) [
    "--initial-packet-size"
    (toString cfg.initialPacketSize)
  ]
  ++ lib.optionals cfg.ipv6 [ "--ipv6" ]
  ++ lib.optionals cfg.noTunnelIPv4 [ "--no-tunnel-ipv4" ]
  ++ lib.optionals cfg.noTunnelIPv6 [ "--no-tunnel-ipv6" ]
  ++ lib.optionals cfg.http2 [ "--http2" ]
  ++ lib.optionals cfg.insecure [ "--insecure" ]
  ++ lib.optionals (builtins.elem cfg.mode proxyModes && cfg.localDNS) [ "--local-dns" ]
  ++ lib.optionals (builtins.elem cfg.mode proxyModes && cfg.localDNS && cfg.systemDNS) [ "--system-dns" ]
  ++ lib.optionals (cfg.alwaysReconnect == true) [ "--always-reconnect" ]
  ++ lib.optionals (cfg.mode == "portfw" && cfg.alwaysReconnect == false) [ "--dont-always-reconnect" ]
  ++ lib.optionals (cfg.onConnect != null) [
    "--on-connect"
    cfg.onConnect
  ]
  ++ lib.optionals (cfg.onDisconnect != null) [
    "--on-disconnect"
    cfg.onDisconnect
  ]
  ++ cfg.extraArgs;

  registerScript = pkgs.writeShellScript "usque-register" ''
    set -euo pipefail
    umask 0077

    state_file=${lib.escapeShellArg registrationStateFile}
    config_file=${lib.escapeShellArg configFile}
    registration_scope=${lib.escapeShellArg registrationScope}
    jwt_file="''${CREDENTIALS_DIRECTORY:-}/jwt"

    jwt_hash=""
    if [ -s "$jwt_file" ]; then
      jwt_hash="$(${pkgs.coreutils}/bin/sha256sum "$jwt_file" | ${pkgs.coreutils}/bin/cut -d' ' -f1)"
    fi

    desired_hash="$(printf '%s\n%s\n' "$registration_scope" "$jwt_hash" | ${pkgs.coreutils}/bin/sha256sum | ${pkgs.coreutils}/bin/cut -d' ' -f1)"
    current_hash=""
    if [ -s "$state_file" ]; then
      current_hash="$(${pkgs.coreutils}/bin/cat "$state_file")"
    fi

    should_register=0
    if [ ! -s "$config_file" ]; then
      should_register=1
    elif [ "$current_hash" != "$desired_hash" ] && [ ${lib.escapeShellArg (if cfg.acceptTerms then "1" else "0")} = "1" ]; then
      should_register=1
    fi

    if [ "$should_register" = "1" ]; then
      if [ ${lib.escapeShellArg (if cfg.acceptTerms then "1" else "0")} != "1" ]; then
        echo "services.usque.acceptTerms must be true before automatic registration." >&2
        exit 1
      fi

      args=(${lib.escapeShellArgs registerArgs})
      if [ -s "$jwt_file" ]; then
        args+=(--jwt "$(${pkgs.coreutils}/bin/cat "$jwt_file")")
      fi

      if [ -s "$config_file" ]; then
        printf 'y\n' | ${usqueExe} "''${args[@]}"
      else
        ${usqueExe} "''${args[@]}"
      fi

      printf '%s\n' "$desired_hash" > "$state_file"
      ${pkgs.coreutils}/bin/chmod 0600 "$config_file" "$state_file"
    fi
  '';

  serviceScript = pkgs.writeShellScript "usque-start" ''
    set -euo pipefail

    args=(${lib.escapeShellArgs serviceArgs})

    credentials_file="''${CREDENTIALS_DIRECTORY:-}/proxy-credentials"
    if [ ${lib.escapeShellArg (if builtins.elem cfg.mode proxyModes then "1" else "0")} = "1" ] && [ -s "$credentials_file" ]; then
      credentials="$(${pkgs.coreutils}/bin/cat "$credentials_file")"
      listener_user="''${credentials%%:*}"
      listener_pass="''${credentials#*:}"
      if [ -z "$listener_user" ] || [ -z "$listener_pass" ] || [ "$listener_user" = "$credentials" ]; then
        echo "services.usque.proxyCredentialsFile must contain username:password" >&2
        exit 1
      fi
      args+=(--username "$listener_user" --password "$listener_pass")
    fi

    exec ${usqueExe} "''${args[@]}"
  '';

  commonHardening = {
    LockPersonality = true;
    NoNewPrivileges = true;
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
    RestrictAddressFamilies = [
      "AF_INET"
      "AF_INET6"
      "AF_UNIX"
    ];
    RestrictRealtime = true;
    RestrictSUIDSGID = true;
    SystemCallArchitectures = "native";
  };

  proxyHardening = commonHardening // {
    DevicePolicy = "closed";
    PrivateDevices = true;
    RestrictNamespaces = true;
  };

  tunHardening = commonHardening // {
    DeviceAllow = [ "/dev/net/tun rw" ];
    DevicePolicy = "closed";
    PrivateDevices = false;
    RestrictAddressFamilies = commonHardening.RestrictAddressFamilies ++ [ "AF_NETLINK" ];
    RestrictNamespaces = true;
  };
in
{
  options.services.usque = {
    enable = lib.mkEnableOption "Cloudflare WARP MASQUE proxy and tunnel";

    package = lib.mkPackageOption pkgs "usque" { };

    acceptTerms = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether to pass --accept-tos during automatic Cloudflare WARP registration.";
    };

    mode = lib.mkOption {
      type = lib.types.enum [
        "socks"
        "http-proxy"
        "nativetun"
        "portfw"
      ];
      default = "socks";
      description = "The usque operation mode.";
    };

    listen = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Proxy bind address for socks and http-proxy modes.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 1080;
      description = "Proxy listen port for socks and http-proxy modes.";
    };

    dns = lib.mkOption {
      type = lib.types.str;
      default = "9.9.9.9,149.112.112.112,2620:fe::fe,2620:fe::9";
      description = "Comma-separated DNS servers used by netstack modes.";
    };

    deviceName = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Device name used during registration.";
    };

    locale = lib.mkOption {
      type = lib.types.str;
      default = "en_US";
      description = "Locale used during registration.";
    };

    model = lib.mkOption {
      type = lib.types.str;
      default = "PC";
      description = "Device model used during registration.";
    };

    jwtFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      description = "Path to a file containing the ZeroTrust JWT token used during registration.";
    };

    proxyCredentialsFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      description = "Path to a file containing proxy credentials in username:password format.";
    };

    connectPort = lib.mkOption {
      type = lib.types.port;
      default = 443;
      description = "Port used for the MASQUE connection.";
    };

    ipv6 = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Use IPv6 for the MASQUE connection.";
    };

    noTunnelIPv4 = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Disable IPv4 inside the MASQUE tunnel.";
    };

    noTunnelIPv6 = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Disable IPv6 inside the MASQUE tunnel.";
    };

    sni = lib.mkOption {
      type = lib.types.str;
      default = "consumer-masque.cloudflareclient.com";
      description = "SNI address used for the MASQUE connection.";
    };

    keepalivePeriod = lib.mkOption {
      type = lib.types.str;
      default = "30s";
      description = "Keepalive period passed to usque.";
    };

    mtu = lib.mkOption {
      type = lib.types.int;
      default = 1280;
      description = "MTU for the MASQUE connection.";
    };

    initialPacketSize = lib.mkOption {
      type = lib.types.nullOr lib.types.int;
      default = null;
      description = "Custom initial packet size. Null keeps usque v3 automatic PMTU behavior.";
    };

    reconnectDelay = lib.mkOption {
      type = lib.types.str;
      default = "1s";
      description = "Delay between reconnect attempts.";
    };

    alwaysReconnect = lib.mkOption {
      type = lib.types.nullOr lib.types.bool;
      default = null;
      description = "Whether to always reconnect after tunnel loss. Null keeps the upstream default for the selected mode.";
    };

    http2 = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Use HTTP/2 over TCP and TLS instead of HTTP/3 over QUIC.";
    };

    insecure = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Disable endpoint certificate pinning.";
    };

    localDNS = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Resolve proxy DNS outside the tunnel.";
    };

    systemDNS = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "With localDNS, resolve names through the OS resolver instead of the configured DNS list.";
    };

    udpTimeout = lib.mkOption {
      type = lib.types.str;
      default = "60s";
      description = "SOCKS5 UDP associate idle timeout.";
    };

    interfaceName = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Custom TUN interface name for nativetun mode.";
    };

    noIproute2 = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "In nativetun mode, do not set addresses or bring the link up on Linux.";
    };

    persist = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "In nativetun mode, keep the TUN interface after exit on Linux.";
    };

    localPorts = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      description = "Port mappings passed as repeated --local-ports values in portfw mode.";
    };

    remotePorts = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      description = "Port mappings passed as repeated --remote-ports values in portfw mode.";
    };

    onConnect = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      description = "Executable hook run after each successful tunnel connection.";
    };

    onDisconnect = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      description = "Executable hook run after each tunnel disconnection.";
    };

    extraArgs = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      description = "Additional arguments appended to the usque service command.";
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.mode != "portfw" || cfg.localPorts != [ ] || cfg.remotePorts != [ ];
        message = "services.usque.portfw requires at least one localPorts or remotePorts mapping.";
      }
      {
        assertion = cfg.proxyCredentialsFile == null || builtins.elem cfg.mode proxyModes;
        message = "services.usque.proxyCredentialsFile only applies to socks and http-proxy modes.";
      }
    ];

    users.users.usque = {
      isSystemUser = true;
      group = "usque";
    };
    users.groups.usque = { };

    systemd.services.usque-register = {
      description = "Cloudflare WARP Device Registration (usque)";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      requiredBy = [ "usque.service" ];
      before = [ "usque.service" ];

      serviceConfig = proxyHardening // {
        Type = "oneshot";
        User = "usque";
        Group = "usque";
        StateDirectory = "usque";
        StateDirectoryMode = "0700";
        UMask = "0077";
        ExecStart = registerScript;
        LoadCredential = lib.optionals (cfg.jwtFile != null) [ "jwt:${cfg.jwtFile}" ];
        CapabilityBoundingSet = "";
      };
    };

    systemd.services.usque = {
      description = "Cloudflare WARP MASQUE Service (usque)";
      after = [
        "network-online.target"
        "usque-register.service"
      ];
      wants = [ "network-online.target" ];
      requires = [ "usque-register.service" ];
      wantedBy = [ "multi-user.target" ];

      serviceConfig = (if needsTun then tunHardening else proxyHardening) // {
        Type = "simple";
        User = "usque";
        Group = "usque";
        StateDirectory = "usque";
        StateDirectoryMode = "0700";
        UMask = "0077";
        ExecStart = serviceScript;
        LoadCredential = lib.optionals (cfg.proxyCredentialsFile != null) [
          "proxy-credentials:${cfg.proxyCredentialsFile}"
        ];
        Restart = "on-failure";
        RestartSec = 5;
        CapabilityBoundingSet =
          (lib.optionals needsPrivilegedPort [ "CAP_NET_BIND_SERVICE" ])
          ++ (lib.optionals needsTun [ "CAP_NET_ADMIN" ]);
        AmbientCapabilities =
          (lib.optionals needsPrivilegedPort [ "CAP_NET_BIND_SERVICE" ])
          ++ (lib.optionals needsTun [ "CAP_NET_ADMIN" ]);
      };
    };
  };
}
