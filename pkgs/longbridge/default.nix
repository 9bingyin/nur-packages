{ lib
, stdenv
, fetchurl
, dpkg
, autoPatchelfHook
, makeWrapper
, wayland
, libxkbcommon
, xorg
, libGL
, libglvnd
, vulkan-loader
, mesa
, libdrm
, gtk3
, gtk4
, glib
, cairo
, pango
, gdk-pixbuf
, atk
, fontconfig
, freetype
, alsa-lib
, libpulseaudio
, pipewire
, openssl
, curl
, zlib
, zstd
, gsettings-desktop-schemas
, libnotify
, libsecret
, at-spi2-core
, at-spi2-atk
, sqlite
, libgit2
, webkitgtk_4_1
, libsoup_3
, cups
, systemd
, bzip2
, xz
, expat
, nspr
, nss
, libgudev
, librsvg
, util-linux
}:

stdenv.mkDerivation rec {
  pname = "longbridge";
  version = "0.6.0";

  src = fetchurl {
    url = "https://assets.lbctrl.com/github/release/longbridge-desktop/stable/longbridge-v${version}-linux-x86_64.deb";
    hash = "sha256-8MdjN8/ikiAgUOhNikqfifVGo9XryZuSh/JlUov7mqk=";
  };

  nativeBuildInputs = [
    dpkg
    autoPatchelfHook
    makeWrapper
  ];

  buildInputs = [
    wayland
    libxkbcommon
    xorg.libX11
    xorg.libXext
    xorg.libxcb
    xorg.libXcomposite
    xorg.libXdamage
    xorg.libXfixes
    xorg.libXrandr
    xorg.libXScrnSaver
    libGL
    libglvnd
    vulkan-loader
    mesa
    libdrm
    gtk3
    gtk4
    glib
    cairo
    pango
    gdk-pixbuf
    atk
    fontconfig
    freetype
    alsa-lib
    libpulseaudio
    pipewire
    openssl
    curl
    zlib
    zstd
    gsettings-desktop-schemas
    libnotify
    libsecret
    at-spi2-core
    at-spi2-atk
    sqlite
    libgit2
    webkitgtk_4_1
    libsoup_3
    cups
    systemd
    bzip2
    xz
    expat
    nspr
    nss
    libgudev
    librsvg
    util-linux
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
          libglvnd
          mesa
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
    maintainers = with maintainers; [ ];
    platforms = [ "x86_64-linux" ];
    sourceProvenance = with sourceTypes; [ binaryNativeCode ];
    mainProgram = "longbridge";
  };
}