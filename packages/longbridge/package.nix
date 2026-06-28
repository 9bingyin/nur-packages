{
  lib,
  stdenv,
  fetchurl,
  dpkg,
  undmg,
  autoPatchelfHook,
  makeWrapper,
  glib,
  gtk3,
  cairo,
  pango,
  gdk-pixbuf,
  freetype,
  webkitgtk_4_1,
  libsoup_3,
  vulkan-loader,
  libGL,
  libX11,
  libxcb,
  libxkbcommon,
  alsa-lib,
  sqlite,
  openssl,
  xz,
}:
let
  version = "0.17.2";
  srcs = {
    x86_64-linux = {
      suffix = "linux-x86_64.deb";
      hash = "sha256-IqXqaoLCPudLexbFw2+usryId4/4kg0LdKrhK85bSZU=";
    };
    aarch64-darwin = {
      suffix = "macos-aarch64.dmg";
      hash = "sha256-rJDmqxIqQc5XaVdjFvvhNUVIUoPoKFNxVUdgLQkHEv8=";
    };
  };
  srcInfo =
    srcs.${stdenv.hostPlatform.system}
      or (throw "longbridge: unsupported system ${stdenv.hostPlatform.system}");
in
stdenv.mkDerivation {
  pname = "longbridge";
  inherit version;

  src = fetchurl {
    url = "https://assets.lbkrs.com/github/release/longbridge-desktop/stable/longbridge-v${version}-${srcInfo.suffix}";
    inherit (srcInfo) hash;
  };

  nativeBuildInputs =
    lib.optionals stdenv.hostPlatform.isLinux [
      dpkg
      autoPatchelfHook
      makeWrapper
    ]
    ++ lib.optionals stdenv.hostPlatform.isDarwin [ undmg ];

  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [
    glib
    gtk3
    cairo
    pango
    gdk-pixbuf
    freetype
    webkitgtk_4_1
    libsoup_3
    vulkan-loader
    libGL
    libX11
    libxcb
    libxkbcommon
    alsa-lib
    sqlite
    openssl
    xz
    stdenv.cc.cc.lib
  ];

  unpackPhase =
    if stdenv.hostPlatform.isLinux then
      "dpkg-deb -x $src ."
    else
      ''
        runHook preUnpack
        undmg $src
        runHook postUnpack
      '';

  sourceRoot = lib.optional stdenv.hostPlatform.isDarwin ".";

  dontFixup = stdenv.hostPlatform.isDarwin;

  installPhase =
    if stdenv.hostPlatform.isDarwin then
      ''
        runHook preInstall

        mkdir -p $out/Applications $out/bin
        cp -R Longbridge.app $out/Applications/

        ln -s $out/Applications/Longbridge.app/Contents/MacOS/longbridge $out/bin/longbridge-desktop

        runHook postInstall
      ''
    else
      ''
        runHook preInstall

        install -Dm755 usr/local/bin/longbridge $out/bin/.longbridge-desktop-unwrapped

        makeWrapper $out/bin/.longbridge-desktop-unwrapped $out/bin/longbridge-desktop \
          --prefix LD_LIBRARY_PATH : "${
            lib.makeLibraryPath [
              vulkan-loader
              libGL
            ]
          }"

        install -Dm644 usr/share/icons/hicolor/512x512/apps/longbridge.png \
          $out/share/icons/hicolor/512x512/apps/longbridge.png
        install -Dm644 usr/share/icons/hicolor/1024x1024/apps/longbridge.png \
          $out/share/icons/hicolor/1024x1024/apps/longbridge.png

        install -Dm644 usr/share/applications/longbridge.desktop \
          $out/share/applications/longbridge.desktop

        substituteInPlace $out/share/applications/longbridge.desktop \
          --replace-quiet "Exec=longbridge" "Exec=longbridge-desktop"

        runHook postInstall
      '';

  meta = with lib; {
    description = "Professional trading platform for stocks and financial instruments";
    homepage = "https://longbridge.com/";
    license = licenses.unfree;
    maintainers = [
      {
        name = "⑨bingyin";
        github = "9bingyin";
      }
    ];
    platforms = [
      "x86_64-linux"
      "aarch64-darwin"
    ];
    sourceProvenance = with sourceTypes; [ binaryNativeCode ];
    mainProgram = "longbridge-desktop";
  };
}
