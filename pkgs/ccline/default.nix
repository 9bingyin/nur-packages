{
  lib,
  rustPlatform,
  fetchFromGitHub,
}:

rustPlatform.buildRustPackage {
  pname = "ccline";
  version = "1.0.8";

  src = fetchFromGitHub {
    owner = "Haleclipse";
    repo = "CCometixLine";
    rev = "e826bef808af86496eda8840156c71e3ef8d0ca6";
    hash = lib.fakeHash;
  };

  cargoHash = lib.fakeHash;

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
    # 在 NUR 中不依赖 nixpkgs 的 maintainers 列表，避免 CI 评估失败
    maintainers = [ ];
  };
}
