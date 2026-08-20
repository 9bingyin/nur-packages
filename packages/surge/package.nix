{
  lib,
  buildGoModule,
  fetchFromGitHub,
  versionCheckHook,
}:
buildGoModule rec {
  pname = "surge";
  version = "0.12.0";

  src = fetchFromGitHub {
    owner = "SurgeDM";
    repo = "Surge";
    rev = "v${version}";
    hash = "sha256-8AhG0GL85CYuaqAAdkcrQoC0gL7Petnpt2ONwyGTiLI=";
  };

  vendorHash = "sha256-5iS75LoN9FC57XRAbIU+Pia1gcXyeiF7bqF3pndYXwM=";

  subPackages = [ "." ];

  env.CGO_ENABLED = 0;

  ldflags = [
    "-s"
    "-w"
    "-X github.com/SurgeDM/Surge/cmd.Version=${version}"
  ];

  # Go installs as "Surge" from the module path on case-sensitive filesystems.
  postInstall = ''
    if [[ -e $out/bin/Surge && ! -e $out/bin/surge ]]; then
      ln -s Surge $out/bin/surge
    fi
  '';

  preCheck = ''
    export HOME=$TMPDIR
    unset CGO_ENABLED
  '';

  nativeInstallCheckInputs = [ versionCheckHook ];
  doInstallCheck = true;

  meta = with lib; {
    description = "Blazing fast TUI download manager built in Go";
    homepage = "https://github.com/SurgeDM/Surge";
    license = licenses.mit;
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "surge";
    platforms = platforms.unix;
  };
}
