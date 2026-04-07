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
  version = "0-unstable-2026-03-09";

  src = fetchFromGitHub {
    owner = "9bingyin";
    repo = "warp";
    rev = "81b67af0756e16c77e21eb131ac23971c2fb5d2a";
    hash = "sha256-IT+eDB0cBQivd871ePOQVu+tXKNkF+XKK/TSn3vHRis=";
  };

  npmDepsHash = "sha256-yEWGktCdQwz7kUq3lR3Qb2LB+QJX1+psnCJeOCT+BCM=";

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
