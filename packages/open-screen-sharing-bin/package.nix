{
  lib,
  stdenvNoCC,
  fetchurl,
  cpio,
  makeWrapper,
  pbzx,
  xar,
  nix-update-script,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "open-screen-sharing-bin";
  version = "1.0.6";

  src = fetchurl {
    url = "https://github.com/nekohasekai/open-screen-sharing/releases/download/v${finalAttrs.version}/OpenScreenSharing.pkg";
    hash = "sha256-klwjhgh5SkR8GCNiqjdipUD5ywV5VUSGdZz07hhhyLE=";
  };

  nativeBuildInputs = [
    cpio
    makeWrapper
    pbzx
    xar
  ];

  dontPatch = true;
  dontConfigure = true;
  dontBuild = true;
  dontFixup = true;
  dontStrip = true;

  unpackPhase = ''
    runHook preUnpack

    mkdir pkg
    cd pkg
    xar -xf "$src"
    pbzx -n component.pkg/Payload | cpio -idm

    runHook postUnpack
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/Applications" "$out/bin"
    cp -R "Open Screen Sharing.app" "$out/Applications/"
    makeWrapper \
      "$out/Applications/Open Screen Sharing.app/Contents/MacOS/Open Screen Sharing" \
      "$out/bin/open-screen-sharing"

    runHook postInstall
  '';

  passthru.updateScript = nix-update-script {
    extraArgs = [
      ''--version-regex=^v([0-9]+(?:\.[0-9]+)+)$''
      "--use-github-releases"
    ];
  };

  meta = {
    description = "Screen sharing for Apple systems";
    homepage = "https://github.com/nekohasekai/open-screen-sharing";
    changelog = "https://github.com/nekohasekai/open-screen-sharing/releases/tag/v${finalAttrs.version}";
    license = lib.licenses.gpl3Plus;
    maintainers = [ lib.maintainers._9bingyin ];
    mainProgram = "open-screen-sharing";
    platforms = lib.platforms.darwin;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
})
