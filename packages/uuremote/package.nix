{
  lib,
  stdenvNoCC,
  fetchurl,
  xar,
  gzip,
  cpio,
  makeWrapper,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "uuremote";
  version = "4.33.0";

  src = fetchurl {
    url = "https://a56.gdl.netease.com/uuyc_${finalAttrs.version}.pkg";
    hash = "sha256-SSqxw2D7MPRx3KcdJGi+k9ananK30lbZEfIJX3Ks790=";
  };

  nativeBuildInputs = [
    xar
    gzip
    cpio
    makeWrapper
  ];

  dontConfigure = true;
  dontBuild = true;
  dontFixup = true;
  dontStrip = true;

  unpackPhase = ''
    runHook preUnpack

    mkdir pkg
    cd pkg
    xar -xf "$src"

    runHook postUnpack
  '';

  installPhase = ''
    runHook preInstall

    mkdir root
    cd root
    gzip -dc ../UURemote.pkg/Payload | cpio -idm --quiet

    mkdir -p "$out/Applications" "$out/bin"
    cp -R Applications/UURemote.app "$out/Applications/"
    makeWrapper \
      "$out/Applications/UURemote.app/Contents/MacOS/UURemote" \
      "$out/bin/uuremote"

    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    test -x "$out/Applications/UURemote.app/Contents/MacOS/UURemote"
    test ! -L "$out/bin/uuremote"
  '';

  meta = {
    description = "NetEase UU remote desktop access and control tool";
    homepage = "https://uuyc.163.com/";
    license = lib.licenses.unfree;
    mainProgram = "uuremote";
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    platforms = [ "aarch64-darwin" ];
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
})
