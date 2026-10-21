{
  lib,
  stdenv,
  fetchFromGitHub,
  fetchPnpmDeps,
  pnpmConfigHook,
  pnpm,
  nodejs,
  makeWrapper,
  autoPatchelfHook,
  llvmPackages,
  musl,
  cacert,
  jq,
  moreutils,
  versionCheckHook,
  writableTmpDirAsHomeHook,
}:
stdenv.mkDerivation (finalAttrs: {
  pname = "cf";
  version = "1.0.0-beta.20";

  src = fetchFromGitHub {
    owner = "cloudflare";
    repo = "cf";
    tag = "cf@${finalAttrs.version}";
    hash = "sha256-t9hazxYXRBNjdQNDVYzUx91tewOWse9NG5IGnsewDJk=";
  };

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs)
      pname
      version
      src
      postPatch
      pnpmWorkspaces
      ;
    inherit pnpm;
    fetcherVersion = 4;
    hash = "sha256-MDn+N4xoe6gcYP+OkuwpBjunkAjIYstWE+jecFOgzPE=";
  };

  pnpmWorkspaces = [ "cf" ];

  postPatch = ''
    jq 'del(.packageManager)' package.json | sponge package.json
  '';

  nativeBuildInputs = [
    nodejs
    pnpm
    pnpmConfigHook
    makeWrapper
    jq
    moreutils
  ]
  ++ lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];

  buildInputs = [
    llvmPackages.libcxx
    llvmPackages.libunwind
  ]
  ++ lib.optionals stdenv.hostPlatform.isLinux [ musl ];

  env.NODE_OPTIONS = "--max-old-space-size=4096";

  preBuild = lib.optionalString stdenv.hostPlatform.isLinux ''
    autoPatchelf node_modules
  '';

  buildPhase = ''
    runHook preBuild

    # The release already contains generated API commands; regeneration needs network access.
    NODE_ENV=production pnpm --filter cf exec vp pack

    runHook postBuild
  '';

  doCheck = true;
  __darwinAllowLocalNetworking = true;

  checkPhase = ''
    runHook preCheck

    substituteInPlace \
      packages/cli/src/__tests__/helpers/executable.ts \
      packages/cli/src/__tests__/commands/dev/spawn.test.ts \
      packages/cli/src/__tests__/commands/dev/discover.test.ts \
      --replace-fail '#!/usr/bin/env node' '#!${lib.getExe nodejs}'
    export SSL_CERT_FILE=${cacert}/etc/ssl/certs/ca-bundle.crt
    # This integration test needs the separately installed Wrangler fixture workspace.
    pnpm --filter cf exec vp test run \
      --testNamePattern='^(?!.*builds and profiles a Worker from cloudflare.config.ts)'

    runHook postCheck
  '';

  installPhase = ''
    runHook preInstall

    pnpm config set --location=project injectWorkspacePackages true
    pnpm --filter cf deploy --prod --offline --ignore-scripts "$out/lib/cf"
    mkdir -p "$out/bin"
    makeWrapper ${lib.getExe nodejs} "$out/bin/cf" \
      --add-flags "$out/lib/cf/bin/cf" \
      --set-default SSL_CERT_FILE "${cacert}/etc/ssl/certs/ca-bundle.crt"
    ln -s cf "$out/bin/cloudflare"

    runHook postInstall
  '';

  doInstallCheck = true;
  nativeInstallCheckInputs = [
    versionCheckHook
    writableTmpDirAsHomeHook
  ];
  versionCheckKeepEnvironment = [ "HOME" ];

  meta = {
    description = "Agentic CLI for the entire Cloudflare API";
    homepage = "https://developers.cloudflare.com/cf/";
    changelog = "https://github.com/cloudflare/cf/releases/tag/${finalAttrs.src.tag}";
    license = with lib.licenses; [
      mit
      asl20
    ];
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "cf";
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
      "aarch64-darwin"
    ];
  };
})
