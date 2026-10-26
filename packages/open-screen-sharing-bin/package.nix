{
  lib,
  stdenvNoCC,
  fetchurl,
  cpio,
  makeWrapper,
  pbzx,
  xar,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "open-screen-sharing-bin";
  version = "1.0.4";

  src = fetchurl {
    url = "https://github.com/nekohasekai/open-screen-sharing/releases/download/v${finalAttrs.version}/OpenScreenSharing.pkg";
    hash = "sha256-BO2nZdiTXTO4Hjwftm4VRdfYriylCiNz/f3eii20w9A=";
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
    cp -R "Screen Sharing.app" "$out/Applications/"
    makeWrapper \
      "$out/Applications/Screen Sharing.app/Contents/MacOS/Screen Sharing" \
      "$out/bin/open-screen-sharing"

    runHook postInstall
  '';

  meta = {
    description = "Screen sharing for Apple systems";
    homepage = "https://github.com/nekohasekai/open-screen-sharing";
    changelog = "https://github.com/nekohasekai/open-screen-sharing/releases/tag/v${finalAttrs.version}";
    license = lib.licenses.gpl3Plus;
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "open-screen-sharing";
    platforms = [ "aarch64-darwin" ];
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
})
