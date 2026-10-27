{
  lib,
  buildGoModule,
  fetchFromGitHub,
  versionCheckHook,
}:
buildGoModule (finalAttrs: {
  pname = "mihomo-smart";
  version = "0-unstable-2026-10-27";

  src = fetchFromGitHub {
    owner = "vernesong";
    repo = "mihomo";
    rev = "ea99c1511bf6e9293530f519ddf346b235dce5df";
    hash = "sha256-UmiuKmOwcKhbqspAwkU9jCHZRC5oi6YqrNYpGVZDnHg=";
  };

  vendorHash = "sha256-koNPc+P0yf7JGEnnGTVHxeHLHz7n87RoQt3Wl4RNl18=";

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
