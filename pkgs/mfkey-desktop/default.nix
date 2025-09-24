{
  lib,
  stdenv,
  fetchFromGitHub,
}:

stdenv.mkDerivation {
  pname = "mfkey-desktop";
  version = "1.0";

  src = fetchFromGitHub {
    owner = "9bingyin";
    repo = "mfkey_desktop";
    rev = "e7f8d90200f71e02a2e1e7cf4bd03bbd1afcf80c";
    hash = "sha256-3kwucgt6PnvgxHShLIcyZlODMdKpOasXaJKRTnLM9nI=";
  };

  buildPhase = ''
    runHook preBuild

    make CC=$CC CFLAGS="$NIX_CFLAGS_COMPILE -O3 -Wall -Wextra -std=c99"

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    install -Dm755 mfkey_desktop $out/bin/mfkey_desktop

    runHook postInstall
  '';

  meta = with lib; {
    description = "MIFARE Classic key recovery desktop tool";
    longDescription = ''
      Desktop tool for recovering MIFARE Classic keys, modified to match
      Flipper Zero mfkey behavior. Supports multiple attack modes including
      mfkey32, static_nested, and static_encrypted.
    '';
    homepage = "https://github.com/9bingyin/mfkey_desktop";
    license = licenses.mit; # License not specified in repo, assuming MIT
    mainProgram = "mfkey_desktop";
    platforms = platforms.linux;
    maintainers = [ ];
  };
}
