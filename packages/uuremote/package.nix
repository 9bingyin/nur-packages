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
  version = "4.38.0";

  src = fetchurl {
    url = "https://a56.gdl.netease.com/uuyc_${finalAttrs.version}.pkg";
    hash = "sha256-qrjKcc8q24elkyBtI1zrkOwGR0JxI3EE8rtvEqpoP9o=";
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

    mkdir -p "$out/Applications" "$out/Library" "$out/bin"
    cp -R Applications/UURemote.app "$out/Applications/"
    cp -R Library/LaunchAgents "$out/Library/"
    cp -R Library/LaunchDaemons "$out/Library/"
    # Normalize launchd unit modes; the vendor payload marks the agent executable.
    chmod 644 "$out/Library/LaunchAgents"/*.plist "$out/Library/LaunchDaemons"/*.plist

    # Official installer renames the channel directory from nochannel.
    if [ -d "$out/Applications/UURemote.app/Contents/Resources/channel/nochannel" ]; then
      mv \
        "$out/Applications/UURemote.app/Contents/Resources/channel/nochannel" \
        "$out/Applications/UURemote.app/Contents/Resources/channel/gwqd"
    fi
    if [ -d "$out/Applications/UURemote.app/Contents/Helpers/UURemoteUpdater.app/Contents/Resources/channel/nochannel" ]; then
      mv \
        "$out/Applications/UURemote.app/Contents/Helpers/UURemoteUpdater.app/Contents/Resources/channel/nochannel" \
        "$out/Applications/UURemote.app/Contents/Helpers/UURemoteUpdater.app/Contents/Resources/channel/gwqd"
    fi

    makeWrapper \
      "$out/Applications/UURemote.app/Contents/MacOS/UURemote" \
      "$out/bin/uuremote"
    makeWrapper \
      "$out/Applications/UURemote.app/Contents/Helpers/uuyc-cli" \
      "$out/bin/uuyc-cli"

    runHook postInstall
  '';

  passthru.updateScript = ./update.py;

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
