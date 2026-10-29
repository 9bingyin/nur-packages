{
  lib,
  buildGoModule,
  clang,
  fetchFromGitHub,
  versionCheckHook,
}:
buildGoModule (finalAttrs: {
  pname = "dae";
  version = "1.1.0-unstable-2026-10-29";

  src = fetchFromGitHub {
    owner = "9bingyin";
    repo = "dae";
    rev = "57416b16502401e0338f05b6a5c4cde911cedddf";
    hash = "sha256-vbSkxZOgXkpKMTxRzX2WPJoTeTsMK8wuEiJVJzx1mMU=";
    fetchSubmodules = true;
  };

  vendorHash = "sha256-j3UxAKzg9XpVOpqhesiHlDNW6O9YRQWTP1uQlzIWg20=";
  proxyVendor = true;

  nativeBuildInputs = [ clang ];

  hardeningDisable = [ "zerocallusedregs" ];

  buildPhase = ''
    runHook preBuild

    make CFLAGS="-D__REMOVE_BPF_PRINTK -fno-stack-protector -Wno-unused-command-line-argument" \
      NOSTRIP=y \
      VERSION=${finalAttrs.version} \
      OUTPUT=$out/bin/dae

    runHook postBuild
  '';

  # Tests require network access.
  doCheck = false;

  postInstall = ''
    install -Dm444 install/dae.service $out/lib/systemd/system/dae.service
    substituteInPlace $out/lib/systemd/system/dae.service \
      --replace-fail "/usr/bin/dae" "$out/bin/dae"
  '';

  nativeInstallCheckInputs = [ versionCheckHook ];
  doInstallCheck = true;

  meta = {
    description = "Fork of dae, a Linux high-performance transparent proxy solution based on eBPF";
    homepage = "https://github.com/9bingyin/dae";
    license = lib.licenses.agpl3Only;
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "dae";
    platforms = lib.platforms.linux;
  };
})
