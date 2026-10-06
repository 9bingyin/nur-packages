{
  _7zz,
  lib,
  stdenv,
  fetchurl,
  autoPatchelfHook,
  makeWrapper,
  wrapGAppsHook3,
  qt6,
  alsa-lib,
  at-spi2-core,
  cairo,
  cups,
  dbus,
  expat,
  glib,
  gtk3,
  gtk4,
  gsettings-desktop-schemas,
  adwaita-icon-theme,
  libGL,
  libgbm,
  libva,
  libx11,
  libxcb,
  libxcomposite,
  libxdamage,
  libxext,
  libxfixes,
  libxkbcommon,
  libxrandr,
  nspr,
  nss,
  pango,
  pipewire,
  udev,
  vulkan-loader,
  wayland,
  xdg-utils,
  coreutils,
}:
let
  sources = builtins.fromJSON (builtins.readFile ./sources.json);
  system = stdenv.hostPlatform.system;
  platform = if stdenv.hostPlatform.isLinux then "linux" else "darwin";
  source = sources.${platform};
  inherit (source) version;
  suffix =
    {
      x86_64-linux = "x86_64_linux.tar.xz";
      aarch64-linux = "arm64_linux.tar.xz";
      aarch64-darwin = "arm64-macos.dmg";
    }
    .${system} or (throw "helium-bin: unsupported system ${system}");
  repository = if platform == "linux" then "helium-linux" else "helium-macos";
  asset =
    if platform == "linux" then "helium-${version}-${suffix}" else "helium_${version}_${suffix}";
  runtimeLibraries = [
    stdenv.cc.cc.lib
    alsa-lib
    at-spi2-core
    cairo
    cups
    dbus
    expat
    glib
    gtk3
    gtk4
    libGL
    libgbm
    libva
    libx11
    libxcb
    libxcomposite
    libxdamage
    libxext
    libxfixes
    libxkbcommon
    libxrandr
    nspr
    nss
    pango
    pipewire
    qt6.qtbase
    qt6.qtwayland
    udev
    vulkan-loader
    wayland
  ];
in
stdenv.mkDerivation {
  pname = "helium-bin";
  inherit version;

  src = fetchurl {
    url = "https://github.com/imputnet/${repository}/releases/download/${version}/${asset}";
    hash = source.hashes.${system};
  };

  nativeBuildInputs = [
    makeWrapper
  ]
  ++ lib.optionals stdenv.hostPlatform.isDarwin [ _7zz ]
  ++ lib.optionals stdenv.hostPlatform.isLinux [
    autoPatchelfHook
    wrapGAppsHook3
    qt6.wrapQtAppsHook
  ];

  buildInputs = lib.optionals stdenv.hostPlatform.isLinux (
    runtimeLibraries
    ++ [
      gsettings-desktop-schemas
      adwaita-icon-theme
    ]
  );

  sourceRoot =
    if stdenv.hostPlatform.isDarwin then
      "Helium"
    else
      "helium-${version}-${lib.removeSuffix ".tar.xz" suffix}";
  unpackCmd = lib.optionalString stdenv.hostPlatform.isDarwin "7zz x -snld -sns- $curSrc";

  dontConfigure = true;
  dontBuild = true;
  dontFixup = stdenv.hostPlatform.isDarwin;
  dontStrip = true;
  dontWrapGApps = true;
  dontWrapQtApps = true;

  installPhase =
    if stdenv.hostPlatform.isDarwin then
      ''
        runHook preInstall

        mkdir -p "$out/Applications" "$out/bin"
        cp -R Helium.app "$out/Applications/"

        makeWrapper \
          "$out/Applications/Helium.app/Contents/MacOS/Helium" \
          "$out/bin/helium" \
          --add-flags "--simulate-outdated-no-au='Tue, 31 Dec 2099 23:59:59 GMT'"

        runHook postInstall
      ''
    else
      ''
        runHook preInstall

        mkdir -p "$out/lib/helium" "$out/bin"
        cp -R . "$out/lib/helium/"
        rm "$out/lib/helium/libqt5_shim.so"

        install -Dm644 helium.desktop "$out/share/applications/helium.desktop"
        install -Dm644 product_logo_256.png "$out/share/icons/hicolor/256x256/apps/helium.png"
        substituteInPlace "$out/share/applications/helium.desktop" \
          --replace-fail 'Exec=helium' "Exec=$out/bin/helium"

        runHook postInstall
      '';

  preFixup = lib.optionalString stdenv.hostPlatform.isLinux ''
    makeShellWrapper "$out/lib/helium/helium" "$out/bin/helium" \
      "''${gappsWrapperArgs[@]}" \
      "''${qtWrapperArgs[@]}" \
      --set CHROME_WRAPPER "$out/bin/helium" \
      --set CHROME_VERSION_EXTRA nix \
      --prefix PATH : "${
        lib.makeBinPath [
          xdg-utils
          coreutils
        ]
      }" \
      --prefix LD_LIBRARY_PATH : "$out/lib/helium:${lib.makeLibraryPath runtimeLibraries}" \
      --add-flags "--simulate-outdated-no-au='Tue, 31 Dec 2099 23:59:59 GMT'" \
      --add-flags "\''${NIXOS_OZONE_WL:+\''${WAYLAND_DISPLAY:+--ozone-platform-hint=auto}}"
  '';

  doInstallCheck = stdenv.hostPlatform.isLinux;
  installCheckPhase = ''
    runHook preInstallCheck
    HOME="$TMPDIR" "$out/bin/helium" --version
    runHook postInstallCheck
  '';

  passthru = {
    updateScript = {
      command = [ ./update.py ];
      supportedFeatures = [
        "commit"
        "same-version"
      ];
    };
  };

  meta = {
    description = "Privacy-first browser without distractions";
    homepage = "https://helium.computer";
    license = lib.licenses.gpl3Only;
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "helium";
    platforms = builtins.attrNames sources.linux.hashes ++ builtins.attrNames sources.darwin.hashes;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
}
