{ pkgs, package }:
pkgs.testers.runNixOSTest {
  name = "vocat";

  nodes.machine = {
    imports = [ ../modules/nixos/vocat.nix ];

    services.vocat = {
      enable = true;
      inherit package;
      enablePCSC = true;
      sessionTTL = "12h";
      shutdownTimeout = "15s";
      maxRequestBodyBytes = 2048;
      initialAdminPasswordFile = "/run/vocat-%n-test-password";
      environment.VOCAT_TEST_PERCENT = "literal%n";
    };

    # Public test fixture, not a deployment secret.
    systemd.tmpfiles.rules = [
      "f /run/vocat-%%n-test-password 0600 root root - vocat-test-password"
    ];
  };

  testScript = ''
    import json
    import shlex
    from datetime import datetime

    machine.start()
    machine.wait_for_unit("vocat.service")
    machine.wait_for_open_port(7575)
    machine.succeed("curl --fail http://127.0.0.1:7575/healthz")
    machine.succeed("curl --fail http://127.0.0.1:7575/ | grep -i '<!doctype html>'")
    machine.succeed("test $(stat -c %a /var/lib/vocat) = 700")
    machine.succeed("test $(stat -c %a /var/lib/vocat/vocat.db) = 600")
    machine.succeed("systemctl is-active pcscd.socket")
    machine.succeed("ss -ltn | grep '127.0.0.1:7575'")
    machine.succeed("systemctl show vocat.service --property=Environment --value | grep -F VOCAT_SHUTDOWN_TIMEOUT=15s")
    machine.succeed("pid=$(systemctl show vocat.service --property=MainPID --value); grep -zFx 'VOCAT_TEST_PERCENT=literal%n' /proc/$pid/environ > /dev/null")

    oversized = json.dumps({"username": "x" * 2048, "password": "unused"})
    response = machine.succeed("curl --silent --show-error -H 'Content-Type: application/json' --data " + shlex.quote(oversized) + " http://127.0.0.1:7575/api/auth/login")
    assert "request body exceeds 2048 bytes" in response, response

    credentials = json.dumps({"username": "admin", "password": "vocat-test-password"})
    login = "curl --fail --silent -H 'Content-Type: application/json' --data " + shlex.quote(credentials) + " http://127.0.0.1:7575/api/auth/login"
    session = json.loads(machine.succeed(login))["data"]
    expires_at = datetime.fromisoformat(session["expires_at"]).timestamp()
    now = int(machine.succeed("date +%s"))
    assert abs(expires_at - now - 12 * 60 * 60) < 30, session["expires_at"]

    # A changed bootstrap secret must not overwrite an existing administrator.
    machine.succeed("printf %s changed-test-password > /run/vocat-%n-test-password")
    machine.succeed("systemctl restart vocat.service")
    machine.wait_for_open_port(7575)
    machine.succeed(login)
    machine.fail(login.replace("vocat-test-password", "changed-test-password"))
  '';
}
