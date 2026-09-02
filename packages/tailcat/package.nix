{
  lib,
  buildGo127Module,
  fetchFromGitHub,
  versionCheckHook,
}:

buildGo127Module (finalAttrs: {
  pname = "tailcat";
  version = "0.5.0";

  __structuredAttrs = true;

  src = fetchFromGitHub {
    owner = "tailscale";
    repo = "tailcat";
    tag = "v${finalAttrs.version}";
    hash = "sha256-mITm3Ro0ZITTrSrNG1o1DepS2dxSYQrzTrObHnn2nsM=";
  };

  vendorHash = "sha256-lznT3EXFHsTS9nn7mVheWJw+2uDtsh1gljqEHxnbdso=";

  subPackages = [ "cmd/tailcat" ];

  ldflags = [
    "-s"
    "-X main.version=v${finalAttrs.version}"
  ];

  env.CGO_ENABLED = "0";

  __darwinAllowLocalNetworking = true;

  doInstallCheck = true;
  nativeInstallCheckInputs = [ versionCheckHook ];
  versionCheckProgramArg = "--version";

  meta = {
    description = "Like netcat, but over Tailscale's data plane, without Tailscale's control plane";
    homepage = "https://github.com/tailscale/tailcat";
    changelog = "https://github.com/tailscale/tailcat/releases/tag/v${finalAttrs.version}";
    license = lib.licenses.bsd3;
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "tailcat";
  };
})
