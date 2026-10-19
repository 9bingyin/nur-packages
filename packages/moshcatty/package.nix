{
  lib,
  rustPlatform,
  fetchFromGitHub,
}:
rustPlatform.buildRustPackage (finalAttrs: {
  pname = "moshcatty";
  version = "0.1.8";

  src = fetchFromGitHub {
    owner = "binaricat";
    repo = "MoshCatty";
    tag = "moshcatty-${finalAttrs.version}";
    hash = "sha256-o+ObAwLRTWHCRo309fke6SmLG1xy9ZtKxhqDnU3Qa9s=";
  };

  # buildRustPackage handles vendoring and the default tests. Upstream's ignored
  # live tests still need a real mosh-server to validate protocol/terminal changes.
  cargoHash = "sha256-NElulYceiLjGhg9qmYWkT6kUyhhCyH4yce5tjDa3uv0=";

  # Upstream UDP/ECN tests need local networking inside the Darwin sandbox.
  __darwinAllowLocalNetworking = true;

  meta = {
    description = "Pure Rust Mosh client for Netcatty";
    homepage = "https://github.com/binaricat/MoshCatty";
    changelog = "https://github.com/binaricat/MoshCatty/releases/tag/${finalAttrs.src.tag}";
    license = lib.licenses.gpl3Plus;
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    # This is a transport client, not the SSH-bootstrap `mosh` wrapper.
    mainProgram = "mosh-client";
    platforms = lib.platforms.unix;
  };
})
