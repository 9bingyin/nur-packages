{
  _7zz,
  lib,
  stdenvNoCC,
  fetchurl,
  makeWrapper,
}:
let
  pname = "helium";
  version = "0.16.4.1";
in
stdenvNoCC.mkDerivation {
  inherit pname version;

  src = fetchurl {
    url = "https://github.com/imputnet/helium-macos/releases/download/${version}/helium_${version}_arm64-macos.dmg";
    hash = "sha256-fJRdy6yoFR0rLCh9Q4p7Rry+aaPZ2SHbh9YMw1tLj2w=";
  };

  nativeBuildInputs = [
    _7zz
    makeWrapper
  ];

  dontUnpack = true;
  dontConfigure = true;
  dontBuild = true;
  dontFixup = true;
  dontStrip = true;

  installPhase = ''
    runHook preInstall

    unpacked="$TMPDIR/Helium"
    mkdir "$unpacked"
    7zz x -snld -sns- -o"$unpacked" "$src"

    mkdir -p "$out/Applications" "$out/bin"
    cp -R "$unpacked/Helium.app" "$out/Applications/"

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
