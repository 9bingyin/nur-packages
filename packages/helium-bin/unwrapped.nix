{
  _7zz,
  lib,
  stdenv,
  fetchurl,
  autoPatchelfHook,
  alsa-lib,
  at-spi2-core,
  cairo,
  cups,
  dbus,
  expat,
  glib,
  gtk3,
  gtk4,
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
  qt6,
  udev,
  vulkan-loader,
  wayland,
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
  # Preserves the historical search order used by LD_LIBRARY_PATH.
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
  # Direct DT_NEEDED libraries. The others are dlopen'd by the wrapper.
  linkedLibraries = [
    stdenv.cc.cc.lib
    alsa-lib
    at-spi2-core
    cairo
    cups
    dbus
    expat
    glib
    libgbm
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
    qt6.qtbase
    udev
  ];
in
stdenv.mkDerivation {
  pname = "helium-bin-unwrapped";
  inherit version;

  src = fetchurl {
    url = "https://github.com/imputnet/${repository}/releases/download/${version}/${asset}";
    hash = source.hashes.${system};
  };

  nativeBuildInputs =
    lib.optionals stdenv.hostPlatform.isDarwin [ _7zz ]
    ++ lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];

  buildInputs = lib.optionals stdenv.hostPlatform.isLinux linkedLibraries;

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
  dontWrapQtApps = true;

  installPhase =
    if stdenv.hostPlatform.isDarwin then
      ''
        runHook preInstall

        mkdir -p "$out/Applications" "$out/bin"
        cp -R Helium.app "$out/Applications/"
        ln -s "$out/Applications/Helium.app/Contents/MacOS/Helium" "$out/bin/helium"

        runHook postInstall
      ''
    else
      ''
        runHook preInstall

        mkdir -p "$out/lib/helium"
        cp -R . "$out/lib/helium/"
        rm "$out/lib/helium/libqt5_shim.so"

        runHook postInstall
      '';

  # Create the executable link after autoPatchelf so it does not rewrite the symlink.
  postFixup = lib.optionalString stdenv.hostPlatform.isLinux ''
    mkdir -p "$out/bin"
    ln -s "$out/lib/helium/helium" "$out/bin/helium"
  '';

  passthru = {
    inherit runtimeLibraries;
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
