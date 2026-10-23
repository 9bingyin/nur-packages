{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.vocat;
  executable = lib.getExe cfg.package;
  escapeSystemdSpecifiers = lib.replaceStrings [ "%" ] [ "%%" ];
  stateDirectory = "/var/lib/vocat";
  databasePath = "${stateDirectory}/vocat.db";
  address =
    if lib.hasInfix ":" cfg.listenAddress then "[${cfg.listenAddress}]" else cfg.listenAddress;
in
{
  options.services.vocat = {
    enable = lib.mkEnableOption "VoCat cellular modem control panel" // {
      description = ''
        Whether to enable VoCat. The service runs as root with network administration
        capabilities and direct device access. On first startup, upstream provisions
        discovered modems with VoWiFi enabled, which may change their radio state.
        Its sandbox blocks sysfs writes,
        including QMI Raw-IP switching and USB resets; configure devices outside
        the service when these operations are needed. Manage updates through Nix,
        not the built-in updater.
      '';
    };

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ../../packages/vocat/package.nix { };
      defaultText = lib.literalExpression "pkgs.callPackage ../../packages/vocat/package.nix { }";
      description = "The VoCat package to run.";
    };

    listenAddress = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      example = "0.0.0.0";
      description = "Address on which the web interface listens, without a port or IPv6 brackets.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 7575;
      description = "Port on which the web interface listens.";
    };

    openFirewall = lib.mkEnableOption "opening the web interface port in the firewall";

    secureCookies = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether to require HTTPS for session cookies. Enable this behind an HTTPS reverse proxy.";
    };

    sessionTTL = lib.mkOption {
      type = lib.types.str;
      default = "24h";
      example = "12h";
      description = ''
        Session lifetime as a Go duration string. VoCat accepts values from
        5 minutes to 30 days (720h).
      '';
    };

    shutdownTimeout = lib.mkOption {
      type = lib.types.str;
      default = "10s";
      example = "30s";
      description = ''
        Graceful HTTP shutdown timeout as a Go duration string.
        VoCat accepts positive values up to 5 minutes.
      '';
    };

    maxRequestBodyBytes = lib.mkOption {
      type = lib.types.ints.between 1024 (10 * 1024 * 1024);
      default = 1024 * 1024;
      example = 2 * 1024 * 1024;
      description = "Maximum JSON request body size in bytes, between 1024 bytes and 10 MiB.";
    };

    initialAdminUsername = lib.mkOption {
      type = lib.types.str;
      default = "admin";
      description = "Administrator username used only when initializing a database without an administrator.";
    };

    initialAdminPasswordFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      example = "/run/secrets/vocat-admin-password";
      description = ''
        Runtime file containing the initial administrator password on its first line.
        The file is read through systemd credentials and must not be stored in the Nix store.
        Existing administrator credentials are not changed. Keep this file available
        on subsequent starts, or set this option back to null after initialization.
        If null, initialize the database manually with
        `vocat bootstrap-admin --database /var/lib/vocat/vocat.db --username admin`
        before starting the service, providing the password on standard input.
      '';
    };

    enablePCSC = lib.mkEnableOption "pcscd for USB SIM card readers";

    environment = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      example = {
        PCSCLITE_CSOCK_NAME = "/run/pcscd/pcscd.comm";
      };
      description = ''
        Additional environment variables for VoCat. Do not put secrets here.
        The process settings exposed above and the database path are managed by
        the module and take precedence over values supplied here.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    services.pcscd.enable = lib.mkIf cfg.enablePCSC true;

    networking.firewall.allowedTCPPorts = lib.mkIf cfg.openFirewall [ cfg.port ];

    environment.systemPackages = [ cfg.package ];

    systemd.services.vocat = {
      description = "VoCat cellular modem control panel";
      wantedBy = [ "multi-user.target" ];
      wants = [ "network-online.target" ] ++ lib.optional cfg.enablePCSC "pcscd.socket";
      after = [ "network-online.target" ] ++ lib.optional cfg.enablePCSC "pcscd.socket";
      path = [ pkgs.systemd ];

      environment = lib.mapAttrs (_: escapeSystemdSpecifiers) (
        cfg.environment
        // {
          VOCAT_ADDR = "${address}:${toString cfg.port}";
          VOCAT_DATABASE_PATH = databasePath;
          VOCAT_SECURE_COOKIES = lib.boolToString cfg.secureCookies;
          VOCAT_SESSION_TTL = cfg.sessionTTL;
          VOCAT_SHUTDOWN_TIMEOUT = cfg.shutdownTimeout;
          VOCAT_MAX_REQUEST_BODY_BYTES = toString cfg.maxRequestBodyBytes;
        }
      );

      preStart = lib.optionalString (cfg.initialAdminPasswordFile != null) ''
        ${executable} bootstrap-admin \
          --database ${lib.escapeShellArg databasePath} \
          --username ${lib.escapeShellArg cfg.initialAdminUsername} \
          < "$CREDENTIALS_DIRECTORY/admin-password"
      '';

      serviceConfig = {
        Type = "simple";
        User = "root";
        Group = "root";
        ExecStart = "${executable} serve";
        WorkingDirectory = stateDirectory;
        StateDirectory = "vocat";
        StateDirectoryMode = "0700";
        RuntimeDirectory = "vocat";
        RuntimeDirectoryMode = "0700";
        LoadCredential = lib.optional (cfg.initialAdminPasswordFile != null) (
          escapeSystemdSpecifiers "admin-password:${cfg.initialAdminPasswordFile}"
        );
        Restart = "on-failure";
        RestartSec = 3;
        TimeoutStopSec = 330;
        UMask = "0077";
        LimitNOFILE = 65536;

        # Modem hotplug, QMI, TUN and XFRM require real devices and host networking.
        AmbientCapabilities = [
          "CAP_NET_ADMIN"
          "CAP_NET_RAW"
        ]
        ++ lib.optional (cfg.port < 1024) "CAP_NET_BIND_SERVICE";
        CapabilityBoundingSet = [
          "CAP_NET_ADMIN"
          "CAP_NET_RAW"
        ]
        ++ lib.optional (cfg.port < 1024) "CAP_NET_BIND_SERVICE";
        NoNewPrivileges = true;
        PrivateTmp = true;
        PrivateDevices = false;
        ProtectSystem = "strict";
        ProtectHome = true;
        ProtectKernelLogs = true;
        ProtectKernelModules = true;
        ProtectKernelTunables = true;
        ProtectControlGroups = true;
        RestrictAddressFamilies = [
          "AF_UNIX"
          "AF_INET"
          "AF_INET6"
          "AF_NETLINK"
          "AF_PACKET"
        ];
        RestrictRealtime = true;
        LockPersonality = true;
        MemoryDenyWriteExecute = true;
      };
    };
  };
}
