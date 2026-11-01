{
  lib,
  stdenv,
  rustPlatform,
  fetchFromGitHub,
  xcbuild,
  darwin,
  coreutils,
  zlib,
  makeWrapper,
  wl-clipboard,
  dbus,
  xvfb,
  util-linux,
  testers,
}:
rustPlatform.buildRustPackage (finalAttrs: {
  pname = "agent-desktop";
  version = "1.0.2";

  src = fetchFromGitHub {
    owner = "vercel-labs";
    repo = "agent-desktop";
    tag = "v${finalAttrs.version}";
    hash = "sha256-0r5bO5oQonq/B/gQYHrjdrQFVfyK3gAZudbaTVe89v0=";
  };

  cargoHash = "sha256-PYZ+PID4Kl3hckTf5RzPXl9JIr+P4lA7Tu2vXXfQ6QM=";

  # Nix-specific: trust only this output's root-owned, read-only helper.
  # Revisit when upstream supports system-wide installs and hard-linked helpers.
  patches =
    lib.optionals stdenv.hostPlatform.isDarwin [ ./allow-nix-store-clipboard-helper.patch ]
    # Remove when upstream can clean up Xvfb without reading its /proc environment.
    ++ lib.optionals stdenv.hostPlatform.isLinux [ ./fix-xvfb-cleanup.patch ];

  # Review test substitutions on upgrades; --replace-fail catches upstream changes.
  postPatch =
    lib.optionalString stdenv.hostPlatform.isDarwin ''
      substituteInPlace crates/macos/src/input/clipboard/clipboard_helper_identity.rs \
        --replace-fail '@helperPath@' "$out/bin/agent-desktop-macos-helper"

      # Tests must use sandbox-visible tools, including BSD chmod for ACL support.
      substituteInPlace \
        crates/macos/src/system/process/process_tests.rs \
        crates/macos/src/system/permissions/permission_guide.rs \
        crates/macos/src/system/screenshot_tests.rs \
        --replace-fail '"/bin/sleep"' '"${lib.getExe' coreutils "sleep"}"'
      substituteInPlace crates/macos/src/system/process/process_tests.rs \
        --replace-fail '"/bin/echo"' '"${lib.getExe' coreutils "echo"}"' \
        --replace-fail '"/usr/bin/true"' '"${lib.getExe' coreutils "true"}"'
      substituteInPlace crates/macos/src/system/process/process_state_tests.rs \
        --replace-fail '"/bin/cat"' '"${lib.getExe' coreutils "cat"}"'
      substituteInPlace crates/macos/src/input/clipboard/clipboard_helper_identity_tests.rs \
        --replace-fail '"chmod"' '"${darwin.file_cmds}/bin/chmod"'
    ''
    + lib.optionalString stdenv.hostPlatform.isLinux ''
      # The test bus must not depend on the host's /etc/dbus-1/session.conf.
      substituteInPlace scripts/private-session.sh \
        --replace-fail 'dbus-daemon --session' \
          'dbus-daemon --config-file=${dbus}/share/dbus-1/session.conf'

      # Nix's multicall coreutils reports "coreutils", not "sleep", in /proc.
      substituteInPlace crates/linux/src/tree/resolve/resolve_errors_tests.rs \
        --replace-fail 'Some("sleep")' 'Some("coreutils")'
    '';

  # Remove when upstream replaces the deprecated AppKit calls or relaxes -Werror.
  env = lib.optionalAttrs stdenv.hostPlatform.isDarwin {
    NIX_CFLAGS_COMPILE = "-Wno-error=deprecated-declarations";
  };

  nativeBuildInputs =
    lib.optionals stdenv.hostPlatform.isDarwin [ xcbuild.xcrun ]
    ++ lib.optionals stdenv.hostPlatform.isLinux [ makeWrapper ];

  # CLI integration tests start a private D-Bus/Xvfb session.
  nativeCheckInputs = lib.optionals stdenv.hostPlatform.isLinux [
    dbus
    xvfb
    util-linux
  ];

  buildInputs = lib.optionals stdenv.hostPlatform.isDarwin [ zlib ];

  # Reject direct tool references, not legitimate transitive runtime dependencies.
  disallowedReferences =
    lib.optionals stdenv.hostPlatform.isDarwin [
      coreutils
      darwin.file_cmds
      xcbuild.xcrun
    ]
    ++ lib.optionals stdenv.hostPlatform.isLinux [
      dbus
      xvfb
      util-linux
      makeWrapper
    ];

  # Each adapter only builds on its own OS; include its companion executable.
  cargoBuildFlags = [
    "-p"
    "agent-desktop"
    "-p"
    "agent-desktop-${if stdenv.hostPlatform.isDarwin then "macos" else "linux"}"
  ];
  # Match upstream CI without applying release LTO to test binaries.
  checkType = "debug";
  cargoTestFlags = finalAttrs.cargoBuildFlags ++ [
    "-p"
    "agent-desktop-core"
  ];

  # Subprocess tests use short filesystem-lock deadlines.
  dontUseCargoParallelTests = stdenv.hostPlatform.isLinux;

  # CDP tests bind and probe loopback TCP listeners.
  __darwinAllowLocalNetworking = true;

  # Revisit these exclusions when upstream separates desktop-only tests.
  checkFlags = [
    # Requires a live desktop session and process inventory outside the sandbox.
    "--skip=tests::list_apps_inventory_matches_the_platform"
  ]
  ++ lib.optionals stdenv.hostPlatform.isDarwin [
    # Inspects root-owned launchd children, which the sandbox cannot enumerate.
    "--skip=system::permissions::permission_guide::tests::the_host_walk_passes_through_a_process_of_another_user"
  ]
  ++ lib.optionals stdenv.hostPlatform.isLinux [
    # Lifecycle methods require a configured X11/Wayland desktop session.
    "--skip=adapter::tests::the_lifecycle_overrides_are_wired_to_the_adapter"
  ];

  preCheck = ''
    export HOME=$(mktemp -d)
  ''
  + lib.optionalString stdenv.hostPlatform.isLinux ''
    # D-Bus fixtures must stay below the Unix socket path length limit.
    export TMPDIR=$(mktemp -d /tmp/ad.XXXXXX)
  '';

  postInstall = lib.optionalString stdenv.hostPlatform.isLinux ''
    wrapProgram $out/bin/agent-desktop \
      --prefix PATH : ${lib.makeBinPath [ wl-clipboard ]}
  '';

  passthru.tests.version = testers.testVersion {
    package = finalAttrs.finalPackage;
    command = "env HOME=$TMPDIR agent-desktop version";
  };

  meta = {
    description = "Computer use for AI agents: read and operate desktop apps through the OS accessibility tree";
    homepage = "https://github.com/vercel-labs/agent-desktop";
    changelog = "https://github.com/vercel-labs/agent-desktop/releases/tag/${finalAttrs.src.tag}";
    license = lib.licenses.asl20;
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "agent-desktop";
    platforms = lib.platforms.linux ++ lib.platforms.darwin;
  };
})
