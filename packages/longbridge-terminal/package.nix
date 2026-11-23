{
  lib,
  rustPlatform,
  fetchFromGitHub,
  pkg-config,
  oniguruma,
  nix-update-script,
}:
rustPlatform.buildRustPackage rec {
  pname = "longbridge-terminal";
  version = "0.32.0";

  src = fetchFromGitHub {
    owner = "longbridge";
    repo = "longbridge-terminal";
    rev = "v${version}";
    hash = "sha256-HWxit6i+KJ4RY0hIH1KaQpuvbshdNA1Z7PW9BeYhOtQ=";
  };

  cargoHash = "sha256-1e70R/8IOVikhQ7knyo6IXVjQTZAr9TQZ68veyBe1WY=";

  nativeBuildInputs = [ pkg-config ];
  buildInputs = [ oniguruma ];

  __darwinAllowLocalNetworking = true;

  preCheck = ''
    export HOME=$(mktemp -d)
  '';

  checkFlags = [
    # Upstream expects the debug-only /debug command in a release-profile test.
    "--skip=ai::tui::tests::every_name_and_alias_resolves"
  ];

  passthru.updateScript = nix-update-script {
    extraArgs = [ "--use-github-releases" ];
  };

  meta = with lib; {
    description = "AI-native CLI for the Longbridge trading platform";
    homepage = "https://github.com/longbridge/longbridge-terminal";
    license = licenses.mit;
    maintainers = [ lib.maintainers._9bingyin ];
    mainProgram = "longbridge";
    platforms = intersectLists (platforms.linux ++ platforms.darwin) (
      platforms.x86_64 ++ platforms.aarch64
    );
  };
}
