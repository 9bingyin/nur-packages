{
  lib,
  stdenvNoCC,
  fetchurl,
  xar,
  gzip,
  cpio,
  makeWrapper,
}:

stdenvNoCC.mkDerivation {
  pname = "synthesizer-v-studio-2-pro";
  version = "2.2.1";

  src = fetchurl {
    url = "https://authr3-media.r2.dreamtonics.com/updates/Synthesizer-V-Studio-2-Pro/svstudio2-pro-setup-2.2.1_2.2.1_131585_dHImfUHcTegfTVBz.pkg";
    hash = "sha256-/CLO6ZCl3HaQPbU8Dpap3VSoHURZmJQDux7MD6bQ/PI=";
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

    extractPayload() {
      gzip -dc "$1/Payload" | cpio -idm --quiet
    }

    mkdir root
    cd root

    extractPayload ../Synthesizer_V_Studio_2_Pro.pkg
    extractPayload ../Synthesizer_V_Studio_2_Plugin_AU.pkg
    extractPayload ../Synthesizer_V_Studio_2_Plugin_VST3.pkg
    extractPayload ../Synthesizer_V_Studio_2_Plugin_AAX.pkg

    mkdir -p "$out/Applications" "$out/Library" "$out/bin"
    cp -R Applications/* "$out/Applications/"
    cp -R Library/* "$out/Library/"

    makeWrapper \
      "$out/Applications/Synthesizer V Studio 2 Pro.app/Contents/MacOS/synthv-studio" \
      "$out/bin/synthv-studio-2-pro"

    runHook postInstall
  '';

  meta = with lib; {
    description = "The Industry-Standard Song & Vocal Production Software";
    homepage = "https://dreamtonics.com/synthesizerv/";
    license = licenses.unfree;
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "synthv-studio-2-pro";
    platforms = platforms.darwin;
    sourceProvenance = [ sourceTypes.binaryNativeCode ];
  };
}
