{
  lib,
  buildGoModule,
  fetchFromGitHub,
  versionCheckHook,
}:
buildGoModule (finalAttrs: {
  pname = "mihomo-smart";
  version = "0-unstable-2026-10-14";

  src = fetchFromGitHub {
    owner = "vernesong";
    repo = "mihomo";
    rev = "83e67d0c4415b1114f9e01d8e9a00133caf89f6c";
    hash = "sha256-vYBu+Lz7OqPgWIdpIb9Dm+tdPiSsJB9WlCtRcpdtw7M=";
  };

  vendorHash = "sha256-HtYAYyv+z3cKOJ7avTMUyb7Gz+qo/BpyTPLeqlkXL3I=";

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
