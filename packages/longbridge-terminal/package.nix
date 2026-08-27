{
  lib,
  rustPlatform,
  fetchFromGitHub,
}:
rustPlatform.buildRustPackage rec {
  pname = "longbridge-terminal";
  version = "0.28.3";

  src = fetchFromGitHub {
    owner = "longbridge";
    repo = "longbridge-terminal";
    rev = "v${version}";
    hash = "sha256-IKdqoC+gegTH3EhskYTMJKUmV6hR613Bv8zcupd3mCI=";
  };

  cargoHash = "sha256-Li/SkxszkO+/4PKxIN2BJHJEM8hNOTWj31lJdDbVos0=";

  preCheck = ''
    export HOME=$(mktemp -d)
  '';

  checkFlags = [
    # Upstream expects the debug-only /debug command in a release-profile test.
    "--skip=ai::tui::tests::every_name_and_alias_resolves"
  ];

  meta = with lib; {
    description = "AI-native CLI for the Longbridge trading platform";
    homepage = "https://github.com/longbridge/longbridge-terminal";
    license = licenses.mit;
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "longbridge";
    platforms = platforms.unix;
  };
}
