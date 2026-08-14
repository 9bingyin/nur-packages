{
  lib,
  rustPlatform,
  fetchFromGitHub,
}:
rustPlatform.buildRustPackage rec {
  pname = "longbridge-terminal";
  version = "0.27.1";

  src = fetchFromGitHub {
    owner = "longbridge";
    repo = "longbridge-terminal";
    rev = "v${version}";
    hash = "sha256-ci+i4YRBxaMmSEAOYsqsOc4yxvQ5hrpLImZGWJiip2E=";
  };

  cargoHash = "sha256-PTzWfQMsW4/UBFbk3r68iXAsbrp9DnpXNRtz8O5rqgc=";

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
