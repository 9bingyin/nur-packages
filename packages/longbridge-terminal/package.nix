{
  lib,
  rustPlatform,
  fetchFromGitHub,
}:
rustPlatform.buildRustPackage rec {
  pname = "longbridge-terminal";
  version = "0.28.7";

  src = fetchFromGitHub {
    owner = "longbridge";
    repo = "longbridge-terminal";
    rev = "v${version}";
    hash = "sha256-ggcVwfoZ1Z4RRRsB3fCJRKJxHRASKATxcrcsPNOOpv8=";
  };

  cargoHash = "sha256-B9D/xvAftN0aZmmPta+HxH4MnuL1K2UzZv7S1JdwbtE=";

  __darwinAllowLocalNetworking = true;

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
