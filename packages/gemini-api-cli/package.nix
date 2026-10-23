{
  lib,
  stdenv,
  buildGoModule,
  fetchFromGitHub,
  installShellFiles,
  nix-update-script,
  versionCheckHook,
}:
buildGoModule (finalAttrs: {
  pname = "gemini-api-cli";
  version = "0.4.3";

  src = fetchFromGitHub {
    owner = "google-gemini";
    repo = "gemini-api-cli";
    tag = "v${finalAttrs.version}";
    hash = "sha256-UhvwPc8lDz9y2g1gRkseL1yg43uojRyc2TbYtE6tAoU=";
  };

  vendorHash = "sha256-or5hd9BJU7avmcbXT5rS6WyqiWWqfDfzmlD7mZZKuCY=";

  subPackages = [ "cmd/gemini-api" ];

  env.CGO_ENABLED = 0;

  ldflags = [
    "-s"
    "-w"
    "-X main.version=${finalAttrs.version}"
  ];

  nativeBuildInputs = [ installShellFiles ];

  # Include internal and contract tests, not just the executable in subPackages.
  checkPhase = ''
    runHook preCheck
    export GOFLAGS=''${GOFLAGS//-trimpath/}
    buildGoDir test ./...
    runHook postCheck
  '';

  # Contract tests use local HTTP servers.
  __darwinAllowLocalNetworking = true;

  postInstall = lib.optionalString (stdenv.buildPlatform.canExecute stdenv.hostPlatform) ''
    installShellCompletion --cmd gemini-api \
      --bash <($out/bin/gemini-api completion bash) \
      --fish <($out/bin/gemini-api completion fish) \
      --zsh <($out/bin/gemini-api completion zsh)
  '';

  nativeInstallCheckInputs = [ versionCheckHook ];
  doInstallCheck = true;

  passthru.updateScript = nix-update-script { };

  meta = {
    description = "Experimental CLI for the Gemini API";
    homepage = "https://github.com/google-gemini/gemini-api-cli";
    changelog = "https://github.com/google-gemini/gemini-api-cli/releases/tag/${finalAttrs.src.tag}";
    license = lib.licenses.asl20;
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "gemini-api";
  };
})
