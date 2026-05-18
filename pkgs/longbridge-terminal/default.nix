{
  lib,
  rustPlatform,
  fetchFromGitHub,
}:
rustPlatform.buildRustPackage rec {
  pname = "longbridge-terminal";
  version = "0.21.0";

  src = fetchFromGitHub {
    owner = "longbridge";
    repo = "longbridge-terminal";
    rev = "v${version}";
    hash = "sha256-67qUEzRdJpdvnut16m6vZ+tbWenyV3ugww4QuRa4RDo=";
  };

  cargoHash = "sha256-/zwMSi3QzL8fLzkUciF1pjxM5VeAAnbFbijbmuGJk/I=";

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
