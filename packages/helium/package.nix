{
  lib,
  stdenvNoCC,
  fetchurl,
  makeWrapper,
}:
let
  pname = "helium";
  version = "0.15.2.1";
in
stdenvNoCC.mkDerivation {
  inherit pname version;

  src = fetchurl {
    url = "https://github.com/imputnet/helium-macos/releases/download/${version}/helium_${version}_arm64-macos.dmg";
    hash = "sha256-+onoZkK37fwg0upK0A03xGmMORC0e8+ozeHqN/2j/X8=";
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

    # Helium releases use an APFS DMG, which undmg cannot extract. hdiutil is
    # used only to mount a private copy of the image; the signed bundle is
    # copied unchanged. The private copy also avoids colliding with a manually
    # mounted copy of the same release.
    /usr/bin/hdiutil attach -nobrowse -readonly -mountpoint "$mountPoint" "$image" >/dev/null

    mkdir -p "$out/Applications" "$out/bin"
    cp -R "$mountPoint/Helium.app" "$out/Applications/"

    makeWrapper \
      "$out/Applications/Helium.app/Contents/MacOS/Helium" \
      "$out/bin/helium" \
      --add-flags "--simulate-outdated-no-au='Tue, 31 Dec 2099 23:59:59 GMT'"

    # Verify that neither extraction nor installation changed the notarized app.
    /usr/bin/codesign --verify --deep --strict "$out/Applications/Helium.app"

    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    test -x "$out/Applications/Helium.app/Contents/MacOS/Helium"
    test ! -L "$out/bin/helium"
    /usr/bin/codesign --verify --deep --strict "$out/Applications/Helium.app"
  '';

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
