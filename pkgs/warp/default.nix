{
  lib,
  buildNpmPackage,
  fetchFromGitHub,
  nodejs,
  esbuild,
  makeWrapper,
}:
buildNpmPackage rec {
  pname = "mihomo-warp";
  version = "0-unstable-2026-04-08";

  src = fetchFromGitHub {
    owner = "9bingyin";
    repo = "warp";
    rev = "f6fa78296e02f6a99118bc20b89cd570dc8b4cb8";
    hash = "sha256-S7kG71ooB2/Acc+MM4QVe0WiVGOfGJrC5H7c+zecztg=";
  };

  npmDepsHash = "sha256-Yw1k0U1jKuAAvwV/Nf3uVhxeMXKn8knmTtLCjhAjNrw=";

  dontNpmBuild = true;

  nativeBuildInputs = [
    esbuild
    makeWrapper
  ];

  buildPhase = ''
    runHook preBuild

    esbuild src/index.ts \
      --bundle \
      --platform=node \
      --format=cjs \
      --outfile=dist/index.js \
      --minify

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib/mihomo-warp $out/bin
    cp dist/index.js $out/lib/mihomo-warp/

    makeWrapper ${nodejs}/bin/node $out/bin/mihomo-warp \
      --add-flags "$out/lib/mihomo-warp/index.js"

    runHook postInstall
  '';

  meta = with lib; {
    description = "Cloudflare WARP device registration tool for mihomo";
    homepage = "https://github.com/9bingyin/warp";
    license = licenses.mit;
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "mihomo-warp";
    platforms = platforms.linux;
  };
}
