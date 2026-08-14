{
  fetchFromGitHub,
  git,
  lib,
  rustPlatform,
}:

rustPlatform.buildRustPackage rec {
  pname = "herdr-file-viewer";
  version = "1.15.0";

  src = fetchFromGitHub {
    owner = "smarzban";
    repo = "herdr-file-viewer";
    rev = "v${version}";
    hash = "sha256-tgy5IHCXqDkIojsP9cDyCG/JXStbjdDdDILopa3SkLI=";
  };

  cargoHash = "sha256-olRYqVTq21A9nkeyy7jGi21OFxcylhQKNfsy6jdO4Ko=";

  nativeCheckInputs = [ git ];

  postInstall = ''
    install -Dm644 herdr-plugin.toml "$out/herdr-plugin.toml"
    install -Dm644 config.example.toml "$out/config.example.toml"
    install -Dm644 assets/markdown-style.json "$out/assets/markdown-style.json"
    install -Dm755 -t "$out/scripts" \
      scripts/fetch-or-build.sh \
      scripts/open-file-viewer.sh \
      scripts/open-file-viewer-tab.sh

    mkdir -p "$out/target/release"
    mv "$out/bin/herdr-file-viewer" "$out/target/release/herdr-file-viewer"
    ln -s ../target/release/herdr-file-viewer "$out/bin/herdr-file-viewer"
  '';

  passthru.pluginId = "herdr-file-viewer";

  meta = {
    description = "Git-aware, read-only file viewer for Herdr";
    homepage = "https://github.com/smarzban/herdr-file-viewer";
    license = lib.licenses.mit;
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "herdr-file-viewer";
    platforms = lib.platforms.linux ++ lib.platforms.darwin;
  };
}
