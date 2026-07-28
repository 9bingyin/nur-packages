{
  lib,
  buildGoModule,
  fetchFromGitHub,
}:
buildGoModule rec {
  pname = "surge";
  version = "0.10.0";

  src = fetchFromGitHub {
    owner = "SurgeDM";
    repo = "Surge";
    rev = "v${version}";
    hash = "sha256-BKRufXVD0h2lNtSwFGGjjHgZLG4C9V0Pq2kCx1VTms0=";
  };

  vendorHash = "sha256-hcDaohgm5B4gn3U3BkFK7Q7kAONc8l/7eKz0y32ZtBY=";

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

  checkPhase = ''
    runHook preCheck
    go test -race ./...
    runHook postCheck
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    $out/bin/surge --version
  '';

  preCheck = ''
    export HOME=$TMPDIR
    unset CGO_ENABLED
  '';

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
