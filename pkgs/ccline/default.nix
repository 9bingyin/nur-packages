{
  lib,
  rustPlatform,
  fetchFromGitHub,
}:

rustPlatform.buildRustPackage {
  pname = "ccline";
  version = "1.0.5";

  src = fetchFromGitHub {
    owner = "Haleclipse";
    repo = "CCometixLine";
    rev = "85e9c366ad51974276ad204322e8a77323e6613c";
    hash = "sha256-3mb8m0uTtTpPBGM48VGWavD9Q7YALGrwoTqQSIR4t5E=";
  };

  cargoHash = "sha256-HI0PAz/zr0dznY46R6SGGaA6LSZyd01YNwsXhNQXtgE=";

  doCheck = false;

  postInstall = ''
    # Rename binary to match expected command name
    mv "$out/bin/ccometixline" "$out/bin/ccline"
  '';

  meta = with lib; {
    description = "High-performance Claude Code status line tool (CCometixLine)";
    homepage = "https://github.com/Haleclipse/CCometixLine";
    license = licenses.mit;
    mainProgram = "ccline";
    platforms = platforms.linux;
    maintainers = with maintainers; [ bingyin ];
  };
}
