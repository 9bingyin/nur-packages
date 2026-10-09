{
  lib,
  rustPlatform,
  fetchFromGitHub,
}:
rustPlatform.buildRustPackage rec {
  pname = "longbridge-terminal";
  version = "0.29.0";

  src = fetchFromGitHub {
    owner = "longbridge";
    repo = "longbridge-terminal";
    rev = "v${version}";
    hash = "sha256-Rx47vez/rPbkzryVQz5AgvVf3OMb6PbxDW6SOQzrZNw=";
  };

  cargoHash = "sha256-JUqowCEAu8Iv7/b82FQToUOyrq33TIn7+izPhJLBHos=";

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
