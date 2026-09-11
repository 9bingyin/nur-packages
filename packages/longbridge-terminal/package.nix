{
  lib,
  rustPlatform,
  fetchFromGitHub,
}:
rustPlatform.buildRustPackage rec {
  pname = "longbridge-terminal";
  version = "0.28.6";

  src = fetchFromGitHub {
    owner = "longbridge";
    repo = "longbridge-terminal";
    rev = "v${version}";
    hash = "sha256-fDyeEA3tsX5R4mLCyG36u81+8y533bPTFPgzK3CZlbk=";
  };

  cargoHash = "sha256-rdmVi+l0vZgRHWQzAYdUF5YnDMCBNBssKa6UXFdiOh8=";

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
