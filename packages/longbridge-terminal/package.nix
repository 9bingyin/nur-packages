{
  lib,
  rustPlatform,
  fetchFromGitHub,
}:
rustPlatform.buildRustPackage rec {
  pname = "longbridge-terminal";
  version = "0.26.0";

  src = fetchFromGitHub {
    owner = "longbridge";
    repo = "longbridge-terminal";
    rev = "v${version}";
    hash = "sha256-kx/D1ViL9lGlnAiaCm0wQRB/ufgVZgsLVs5lZ2lOWpA=";
  };

  cargoHash = "sha256-f1ubIx2yy+R/HwQlfOseOZo10DevxKKVHVRNVNwPk4c=";

  preCheck = ''
    export HOME=$(mktemp -d)
  '';

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
