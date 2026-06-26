{
  lib,
  rustPlatform,
  fetchFromGitHub,
}:
rustPlatform.buildRustPackage rec {
  pname = "longbridge-terminal";
  version = "0.24.0";

  src = fetchFromGitHub {
    owner = "longbridge";
    repo = "longbridge-terminal";
    rev = "v${version}";
    hash = "sha256-cLts4tbOEYnT83Cn13jKwdPwirxnvZ4sOBHG6JpcTQ4=";
  };

  cargoHash = "sha256-qXMLzq9ztoM0kCQkZIiLkjMDOYQtx7dNU2Kh2rWWV9o=";

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
