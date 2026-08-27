{
  lib,
  stdenvNoCC,
  fetchurl,
  makeWrapper,
}:
let
  pname = "helium";
  version = "0.15.7.1";
in
stdenvNoCC.mkDerivation {
  inherit pname version;

  src = fetchurl {
    url = "https://github.com/imputnet/helium-macos/releases/download/${version}/helium_${version}_arm64-macos.dmg";
    hash = "sha256-QQT3dtBKQvnGi3ySsgaVeXGqKIJ/iys5fDApZnDlt5E=";
  };

  nativeBuildInputs = [ makeWrapper ];

  dontUnpack = true;
  dontConfigure = true;
  dontBuild = true;
  dontFixup = true;
  dontStrip = true;

  installPhase = ''
    runHook preInstall

    image="$TMPDIR/Helium.dmg"
    mountPoint="$TMPDIR/Helium"
    cp "$src" "$image"
    mkdir "$mountPoint"
    cleanup() {
      /usr/bin/hdiutil detach "$mountPoint" -quiet || true
    }
    trap cleanup EXIT

    # APFS DMG: undmg cannot extract it. Copy first to avoid a mounted original.
    /usr/bin/hdiutil attach -nobrowse -readonly -mountpoint "$mountPoint" "$image" >/dev/null

    mkdir -p "$out/Applications" "$out/bin"
    cp -R "$mountPoint/Helium.app" "$out/Applications/"

    makeWrapper \
      "$out/Applications/Helium.app/Contents/MacOS/Helium" \
      "$out/bin/helium" \
      --add-flags "--simulate-outdated-no-au='Tue, 31 Dec 2099 23:59:59 GMT'"

    runHook postInstall
  '';

  passthru.updateScript = ./update.py;

  meta = {
    description = "Privacy-focused Chromium browser for macOS";
    homepage = "https://github.com/imputnet/helium";
    license = lib.licenses.gpl3Only;
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "helium";
    platforms = [ "aarch64-darwin" ];
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
}
