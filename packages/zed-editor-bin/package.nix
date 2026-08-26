{
  lib,
  stdenvNoCC,
  fetchurl,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "zed-editor-bin";
  version = "1.17.2";

  src = fetchurl {
    url = "https://github.com/zed-industries/zed/releases/download/v${finalAttrs.version}/Zed-aarch64.dmg";
    hash = "sha256-gguuh+RAVtWZJNVDwwVA98VtNLnHqBaQP1sdopIU44k=";
  };

  dontUnpack = true;
  dontPatch = true;
  dontConfigure = true;
  dontBuild = true;
  dontFixup = true;
  dontStrip = true;

  installPhase = ''
    runHook preInstall

    mountPoint="$TMPDIR/Zed"
    mkdir "$mountPoint"
    trap '/usr/bin/hdiutil detach "$mountPoint" -quiet || true' EXIT

    /usr/bin/hdiutil attach -nobrowse -readonly -mountpoint "$mountPoint" "$src" >/dev/null

    mkdir -p "$out/Applications" "$out/bin"
    /usr/bin/ditto "$mountPoint/Zed.app" "$out/Applications/Zed.app"
    ln -s "$out/Applications/Zed.app/Contents/MacOS/cli" "$out/bin/zeditor"

    /usr/bin/hdiutil detach "$mountPoint" -quiet
    trap - EXIT

    runHook postInstall
  '';

  meta = {
    description = "High-performance, multiplayer code editor from the creators of Atom and Tree-sitter";
    homepage = "https://zed.dev";
    changelog = "https://zed.dev/releases/stable/${finalAttrs.version}";
    license = lib.licenses.gpl3Only;
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "zeditor";
    platforms = [ "aarch64-darwin" ];
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
})
