{
  lib,
  rustPlatform,
  fetchFromGitHub,
}:

rustPlatform.buildRustPackage {
  pname = "ccline";
  version = "unstable-2025-09-16";

  src = fetchFromGitHub {
    owner = "Haleclipse";
    repo = "CCometixLine";
    rev = "master";
    hash = "sha256-3mb8m0uTtTpPBGM48VGWavD9Q7YALGrwoTqQSIR4t5E=";
  };

  cargoHash = "sha256-HI0PAz/zr0dznY46R6SGGaA6LSZyd01YNwsXhNQXtgE=";

  doCheck = false;

  postInstall = ''
    # Upstream binary is likely named 'ccometixline'; provide a friendly 'ccline' alias
    if [ -x "$out/bin/ccometixline" ] && [ ! -e "$out/bin/ccline" ]; then
      ln -s ccometixline "$out/bin/ccline"
    fi
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
