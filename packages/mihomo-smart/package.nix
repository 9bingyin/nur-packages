{
  lib,
  buildGoModule,
  fetchFromGitHub,
  versionCheckHook,
}:
buildGoModule (finalAttrs: {
  pname = "mihomo-smart";
  version = "0-unstable-2026-10-24";

  src = fetchFromGitHub {
    owner = "vernesong";
    repo = "mihomo";
    rev = "1f9b2c2bfca4cf867967f8266cf609fe7c3d236d";
    hash = "sha256-KVc3ki2+V/3HkmDZjG2oC2CqfAm4f2O4p6PVCZT4oz4=";
  };

  vendorHash = "sha256-FQ02hty2kpiqnxG+LLqtYLmgO9C+ZZK6JWNmYW5h/W8=";

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
