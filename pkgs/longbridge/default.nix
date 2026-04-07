{
  lib,
  stdenv,
  fetchurl,
  dpkg,
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
stdenv.mkDerivation rec {
  pname = "longbridge";
  version = "0.14.0";

  src = fetchurl {
    url = "https://assets.lbkrs.com/github/release/longbridge-desktop/stable/longbridge-v${version}-linux-x86_64.deb";
    hash = "sha256-BG3ndFNXIyIRDn6UhA5XM4Xd9BH18ENG211pyVjvBog=";
  };

  nativeBuildInputs = [
    dpkg
    autoPatchelfHook
    makeWrapper
  ];

  buildInputs = [
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

  unpackPhase = "dpkg-deb -x $src .";

  installPhase = ''
    runHook preInstall

    install -Dm755 usr/local/bin/longbridge $out/bin/.longbridge-unwrapped

    makeWrapper $out/bin/.longbridge-unwrapped $out/bin/longbridge \
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
    platforms = [ "x86_64-linux" ];
    sourceProvenance = with sourceTypes; [ binaryNativeCode ];
    mainProgram = "longbridge";
  };
}
