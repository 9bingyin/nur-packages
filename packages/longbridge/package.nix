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
  version = "0.20.0";
  srcs = {
    x86_64-linux = {
      suffix = "linux-x86_64.deb";
      hash = "sha256-nCJjKyCjksE1zjr0yHISy3IBvgGCCJLJWczlxi8a0Q8=";
    };
    aarch64-darwin = {
      suffix = "macos-aarch64.dmg";
      hash = "sha256-9zKYQKh1d/reaEYU6JnwfVpC2kSj4x8UMtfAM7MWob0=";
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
    ++ lib.optionals stdenv.hostPlatform.isDarwin [
      makeWrapper
      undmg
    ];

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

        makeWrapper \
          $out/Applications/Longbridge.app/Contents/MacOS/longbridge \
          $out/bin/longbridge-desktop

        runHook postInstall
      ''
    else
      ''
        runHook preInstall

        install -Dm755 "$(readlink -f usr/bin/longbridge-desktop)" \
          $out/lib/longbridge-desktop/longbridge
        cp -R usr/share $out/

        makeWrapper $out/lib/longbridge-desktop/longbridge $out/bin/longbridge-desktop \
          --prefix LD_LIBRARY_PATH : "${
            lib.makeLibraryPath [
              vulkan-loader
              libGL
            ]
          }"

        substituteInPlace $out/share/applications/longbridge-desktop.desktop \
          --replace-fail "/usr/lib/longbridge-desktop/longbridge" "longbridge-desktop"

        runHook postInstall
      '';

  passthru.updateScript = ./update.py;

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
