{
  _7zz,
  lib,
  stdenvNoCC,
  fetchurl,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "zed-editor-bin";
  version = "1.27.0";

  src = fetchurl {
    url = "https://zed.dev/api/releases/stable/${finalAttrs.version}/Zed-aarch64.dmg";
    hash = "sha256-jc/fqpSRfOzg/1Krbj9xF8Zke3jzLSZmhM8ME0Ytdqg=";
  };

  nativeBuildInputs = [ _7zz ];

  dontUnpack = true;
  dontPatch = true;
  dontConfigure = true;
  dontBuild = true;
  dontFixup = true;
  dontStrip = true;

  installPhase = ''
    runHook preInstall

    unpacked="$TMPDIR/Zed"
    mkdir "$unpacked"
    7zz x -snld -sns- -o"$unpacked" "$src"

    mkdir -p "$out/Applications" "$out/bin"
    cp -R "$unpacked/Zed.app" "$out/Applications/Zed.app"
    ln -s "$out/Applications/Zed.app/Contents/MacOS/cli" "$out/bin/zeditor"

    runHook postInstall
  '';

  passthru.updateScript = ./update.ts;

  meta = {
    description = "High-performance, multiplayer code editor from the creators of Atom and Tree-sitter";
    homepage = "https://zed.dev";
    changelog = "https://zed.dev/releases/stable/${finalAttrs.version}";
    license = lib.licenses.gpl3Only;
    maintainers = [ lib.maintainers._9bingyin ];
    mainProgram = "zeditor";
    platforms = lib.platforms.darwin;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
})
