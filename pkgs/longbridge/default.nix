{
  lib,
  fetchurl,
  appimageTools,
  # GUI 依赖
  glib,
  gtk3,
  cairo,
  pango,
  gdk-pixbuf,
  freetype,
  webkitgtk_4_1,
  libsoup_3,
  # 图形和音频
  vulkan-loader,
  libGL,
  xorg,
  libxkbcommon,
  alsa-lib,
  # 系统库
  sqlite,
  openssl,
  xz,
}:

let
  version = "0.6.0";

  src = fetchurl {
    url = "https://assets.lbctrl.com/github/release/longbridge-desktop/stable/longbridge-v${version}-linux-x86_64.AppImage";
    hash = "sha256-Old7s2v7QMUj4dTJ01BI/e+6XnQjBBrOqPI3I6z8MOQ=";
  };

  # 运行时依赖库
  runtimeLibraries = [
    # GUI 框架
    glib
    gtk3
    cairo
    pango
    gdk-pixbuf
    freetype
    webkitgtk_4_1
    libsoup_3
    # 图形支持
    vulkan-loader
    libGL
    xorg.libX11
    xorg.libxcb
    libxkbcommon
    # 音频支持
    alsa-lib
    # 系统库
    sqlite
    openssl
    xz
  ];

  longbridgeExtracted = appimageTools.extract {
    pname = "longbridge";
    inherit version src;
  };

in
appimageTools.wrapType2 {
  pname = "longbridge";
  inherit version src;

  extraPkgs = pkgs: runtimeLibraries;

  extraInstallCommands = ''
        # 确保二进制文件有正确的名称
        if [ -e "$out/bin/longbridge-${version}" ]; then
          mv "$out/bin/longbridge-${version}" "$out/bin/longbridge"
        fi

        # 安装图标文件
        install -Dm444 "${longbridgeExtracted}/usr/share/icons/hicolor/1024x1024/apps/longbridge.png" \
          "$out/share/icons/hicolor/1024x1024/apps/longbridge.png"
        install -Dm444 "${longbridgeExtracted}/usr/share/icons/hicolor/512x512/apps/longbridge.png" \
          "$out/share/icons/hicolor/512x512/apps/longbridge.png"
        install -Dm444 "${longbridgeExtracted}/longbridge.png" \
          "$out/share/pixmaps/longbridge.png"

        # 安装桌面文件
        mkdir -p "$out/share/applications"
        cat > "$out/share/applications/longbridge.desktop" << EOF
    [Desktop Entry]
    Type=Application
    Name=Longbridge
    Name[zh_CN]=长桥证券
    Comment=Professional trading platform for stocks and financial instruments
    Comment[zh_CN]=专业的股票和金融工具交易平台
    Exec=$out/bin/longbridge %U
    Icon=longbridge
    Terminal=false
    Categories=Office;Finance;
    MimeType=x-scheme-handler/longbridge;
    StartupWMClass=longbridge
    EOF
  '';

  meta = with lib; {
    description = "Professional trading platform for stocks and financial instruments";
    longDescription = ''
      Longbridge is a comprehensive trading platform that provides access to
      global stock markets including Hong Kong, US, and other international markets.
      It offers real-time market data, advanced charting tools, and professional
      trading features for both individual and institutional investors.
    '';
    homepage = "https://longbridge.com/";
    license = licenses.unfree;
    maintainers = with maintainers; [ bingyin ];
    platforms = [ "x86_64-linux" ];
    sourceProvenance = with sourceTypes; [ binaryNativeCode ];
    mainProgram = "longbridge";
  };
}
