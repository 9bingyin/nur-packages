{
  fetchFromGitHub,
  git,
  lib,
  rustPlatform,
}:

rustPlatform.buildRustPackage rec {
  pname = "herdr-file-viewer";
  version = "1.16.0";

  src = fetchFromGitHub {
    owner = "smarzban";
    repo = "herdr-file-viewer";
    rev = "v${version}";
    hash = "sha256-2vI98QRm6vXDe8IkJBPAqFsQH86zX1oJVwCaoOVYrQs=";
  };

  cargoHash = "sha256-17cHnKylDkRIVErgN6kDd70ZkGQy+V3GK0m0Ntg1R3E=";

  nativeCheckInputs = [ git ];

  checkFlags = [
    # Wall-clock scaling tests are not deterministic under parallel Nix builds.
    "--skip=fuzzy_match_scales_linearly"
    "--skip=index_build_scales_linearly"
  ];

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
