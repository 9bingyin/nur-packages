{
  lib,
  buildGoModule,
  fetchFromGitHub,
  versionCheckHook,
}:
buildGoModule (finalAttrs: {
  pname = "mihomo-smart";
  version = "0-unstable-2026-10-30";

  src = fetchFromGitHub {
    owner = "vernesong";
    repo = "mihomo";
    rev = "77af4804d091d89b871c99b52d50915f4a600d81";
    hash = "sha256-Q5GQ08/hig8SNxxhDnmNAZSUjTG9/d1kAgSxYUcOf8c=";
  };

  vendorHash = "sha256-XTL/gKKOfsAnMkOU/Uc5Zk3Txvt8uZZlv1S7fPZpF+c=";

  excludedPackages = [ "./test" ];

  ldflags = [
    "-s"
    "-w"
    "-X github.com/metacubex/mihomo/constant.Version=${finalAttrs.version}"
  ];

  tags = [ "with_gvisor" ];

  # Tests require network access.
  doCheck = false;

  postInstall = ''
    mv "$out/bin/mihomo" "$out/bin/mihomo-smart"
  '';

  nativeInstallCheckInputs = [ versionCheckHook ];
  doInstallCheck = true;
  versionCheckProgramArg = "-v";

  meta = {
    description = "Rule-based tunnel with adaptive proxy selection";
    homepage = "https://github.com/vernesong/mihomo/tree/Alpha";
    license = lib.licenses.gpl3Only;
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "mihomo-smart";
  };
})
