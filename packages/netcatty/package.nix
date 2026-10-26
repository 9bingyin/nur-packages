{
  lib,
  stdenv,
  buildNpmPackage,
  fetchFromGitHub,
  autoPatchelfHook,
  copyDesktopItems,
  electron,
  eternal-terminal,
  jq,
  makeDesktopItem,
  makeWrapper,
  moshcatty,
  openssh,
}:
buildNpmPackage (finalAttrs: {
  pname = "netcatty";
  version = "1.1.90";

  src = fetchFromGitHub {
    owner = "binaricat";
    repo = "Netcatty";
    tag = "v${finalAttrs.version}";
    hash = "sha256-S8EEi3R5aJt/XCBwvs9LCIiTRY+1tjhAm+DeYbLoLAA=";
  };

  # Nix owns updates. Refresh this git-generated patch if the upstream update
  # bridge or its download/install IPC handlers change.
  patches = [ ./disable-auto-updates.patch ];

  npmDepsHash = "sha256-mx25T2G6bTk6N7qujWaQ52NFicoJnWN16y0neRLxCzA=";
  # The root postinstall runs electron-builder. Defer lifecycle scripts so patches
  # are applied before the packaging step discovers and rebuilds native addons.
  npmRebuildFlags = [ "--ignore-scripts" ];

  nativeBuildInputs = [
    autoPatchelfHook
    copyDesktopItems
    jq
    makeWrapper
  ];
  buildInputs = [ stdenv.cc.cc.lib ];

  env.ELECTRON_SKIP_BINARY_DOWNLOAD = "1";

  postPatch = ''
    # beforePack installs SDKs for both Linux architectures online. The lockfile
    # already provides the host SDK; review any new hook responsibilities on updates.
    substituteInPlace electron-builder.config.cjs \
      --replace-fail "beforePack: './scripts/beforePackCursorSdk.cjs'" "beforePack: null"

    # System Electron otherwise points at its own resources, not this app's ASAR
    # and helpers. Recheck new resource users/layouts when upstream changes them.
    while IFS= read -r -d $'\0' file; do
      substituteInPlace "$file" \
        --replace-fail 'process.resourcesPath' "\"$out/share/netcatty\""
    done < <(grep -rlZ 'process.resourcesPath' electron --include='*.cjs')
  '';

  postConfigure = ''
    # Mirror the platform-independent parts of package.json's postinstall.
    # Review that script on updates: skipping lifecycle scripts must not drop fixes.
    node_modules/.bin/patch-package
    node scripts/patch-xterm-macos-column-selection.cjs
    node scripts/patch-xterm-foreground-intense.cjs
    node scripts/patch-xterm-webgl-atlas.cjs

    # Remove vendored prebuilds so loaders cannot select foreign/musl binaries.
    # Recheck prebuild locations when dependencies or their native loaders change.
    rm -rf node_modules/node-pty/prebuilds node_modules/@serialport/bindings-cpp/prebuilds
    # npmConfigHook sets Node headers unconditionally; override them after it runs.
    export npm_config_nodedir=${electron.headers}

    # Tagged sources still say 0.0.0; upstream release CI normally injects this.
    jq --arg version ${lib.escapeShellArg finalAttrs.version} '.version = $version' package.json > package.json.tmp
    mv package.json.tmp package.json
  '';

  postBuild = ''
    # electron-builder copies the distribution and discovers native addons itself.
    # Force source rebuilds against the nixpkgs Electron version, not upstream prebuilds.
    node_modules/.bin/electron-builder \
      --config electron-builder.config.cjs \
      --linux --dir --publish=never \
      -c.electronDist=${electron.dist} \
      -c.electronVersion=${electron.version} \
      -c.npmRebuild=true \
      -c.buildDependenciesFromSource=true
  '';

  installPhase = ''
    runHook preInstall

    # Preserve ASAR and unpacked files together; review paths if builder layout changes.
    mkdir -p "$out/share/netcatty"
    cp -R release/linux-*/resources/. "$out/share/netcatty/"
    # Netcatty only searches bundled helpers, not PATH. Recheck its handshake/CLI
    # contract when updating MoshCatty or Eternal Terminal independently.
    mkdir -p "$out/share/netcatty/mosh" "$out/share/netcatty/et"
    ln -s ${lib.getExe moshcatty} "$out/share/netcatty/mosh/mosh-client"
    ln -s ${eternal-terminal}/bin/et "$out/share/netcatty/et/et"

    # Upstream names icons <width>x<height>.png; keep this in sync if it moves them.
    for icon in build/icons/*.png; do
      size="''${icon##*/}"
      install -Dm644 "$icon" "$out/share/icons/hicolor/''${size%.png}/apps/netcatty.png"
    done

    makeWrapper ${lib.getExe electron} "$out/bin/netcatty" \
      --add-flags "$out/share/netcatty/app.asar" \
      --add-flags "\''${NIXOS_OZONE_WL:+\''${WAYLAND_DISPLAY:+--ozone-platform-hint=auto --enable-wayland-ime=true}}" \
      --prefix PATH : ${lib.makeBinPath [ openssh ]}

    runHook postInstall
  '';

  desktopItems = [
    (makeDesktopItem {
      name = "netcatty";
      desktopName = "Netcatty";
      comment = finalAttrs.meta.description;
      exec = "netcatty %U";
      icon = "netcatty";
      categories = [
        "Development"
        "Network"
      ];
      # Keep scheme handlers aligned with electron-builder.config.cjs protocols.
      mimeTypes = [
        "x-scheme-handler/ssh"
        "x-scheme-handler/telnet"
        "x-scheme-handler/jms"
      ];
    })
  ];

  passthru = {
    inherit moshcatty;
  };

  meta = {
    description = "SSH workspace, SFTP, and terminals in one";
    homepage = "https://github.com/binaricat/Netcatty";
    changelog = "https://github.com/binaricat/Netcatty/releases/tag/${finalAttrs.src.tag}";
    license = lib.licenses.gpl3Plus;
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "netcatty";
    # Darwin needs a separate .app bundle installation/signing path.
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
    ];
    # Cursor SDK still bundles native binaries; rebuilding the addons is not enough
    # to remove binaryNativeCode. Re-audit SDK payloads if dependency packaging changes.
    sourceProvenance = with lib.sourceTypes; [
      fromSource
      binaryNativeCode
    ];
  };
})
