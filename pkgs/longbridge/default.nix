{ lib
, stdenv
, fetchurl
, dpkg
, autoPatchelfHook
, makeWrapper
# 核心 GTK/GUI 依赖
, glib
, gtk3
, cairo
, pango
, gdk-pixbuf
, freetype
# Web 引擎
, webkitgtk_4_1
, libsoup_3
# X11/键盘支持
, xorg
, libxkbcommon
# 音频
, alsa-lib
# 数据库
, sqlite
# 加密
, openssl
# 压缩
, xz
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
    # GTK/GUI 核心依赖
    glib
    gtk3
    cairo
    pango
    gdk-pixbuf
    freetype

    # Web 引擎 (基于 WebKitGTK)
    webkitgtk_4_1
    libsoup_3

    # X11 支持
    xorg.libX11
    xorg.libxcb
    libxkbcommon

    # 音频支持
    alsa-lib

    # 数据库
    sqlite

    # 加密库
    openssl

    # 压缩支持
    xz

    # C++ 标准库
    stdenv.cc.cc.lib
  ];

  unpackPhase = "dpkg-deb -x $src .";

  installPhase = ''
    runHook preInstall

    install -Dm755 usr/local/bin/longbridge $out/bin/.longbridge-unwrapped

    makeWrapper $out/bin/.longbridge-unwrapped $out/bin/longbridge

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