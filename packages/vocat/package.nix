{
  lib,
  buildGoModule,
  buildNpmPackage,
  fetchFromGitHub,
  makeBinaryWrapper,
  coreutils,
  iproute2,
  libqmi,
  busybox,
  nftables,
  testers,
}:
buildGoModule (finalAttrs: {
  pname = "vocat";
  version = "0.3.35";

  src = fetchFromGitHub {
    owner = "MengMengCode";
    repo = "VoCat";
    tag = "v${finalAttrs.version}";
    hash = "sha256-8ZSSV6kgwVYwgNpuLqeotZnOQLfr1aiOBvU6eKDVj9w=";
  };

  vendorHash = "sha256-EwUg4+CeDCu815EOwV7UOeMLL2hlqlpRravoZzOth/E=";

  subPackages = [ "cmd/vocat" ];
  env.CGO_ENABLED = 0;

  ldflags = [
    "-s"
    "-w"
    "-X vocat/internal/buildinfo.Version=${finalAttrs.version}"
  ];

  nativeBuildInputs = [ makeBinaryWrapper ];

  # Keep Go dependency vendoring independent of the frontend build.
  preConfigure = ''
    cp -r ${finalAttrs.passthru.web}/dist web/dist
  '';

  preCheck = ''
    substituteInPlace internal/device/data_linux_test.go \
      --replace-fail '"/bin/true"' '"${coreutils}/bin/true"'
  '';

  # Include internal packages rather than only the executable in subPackages.
  checkPhase = ''
    runHook preCheck
    export GOFLAGS=''${GOFLAGS//-trimpath/}
    buildGoDir test ./...
    runHook postCheck
  '';

  postInstall = ''
    wrapProgram $out/bin/vocat \
      --prefix PATH : ${
        lib.makeBinPath [
          iproute2
          libqmi
          # Applet symlinks would shadow NixOS tools such as modprobe.
          (busybox.override { enableAppletSymlinks = false; })
          nftables
        ]
      }
    install -Dm644 LICENSE $out/share/doc/vocat/LICENSE
    install -Dm644 NOTICE $out/share/doc/vocat/NOTICE
    cp -r LICENSES $out/share/doc/vocat/
  '';

  passthru = {
    web = buildNpmPackage {
      pname = "vocat-web";
      inherit (finalAttrs) version src;
      sourceRoot = "${finalAttrs.src.name}/web";
      npmDepsHash = "sha256-OsEaH+iaEMXs5vseXkdB9LVpQiJKLonnMzcX80nKiZA=";
      doCheck = true;
      checkPhase = ''
        runHook preCheck
        npm test
        runHook postCheck
      '';
      installPhase = ''
        runHook preInstall
        mkdir -p $out
        cp -r dist $out/dist
        runHook postInstall
      '';
      meta.license = lib.licenses.unfree;
    };
    tests.version = testers.testVersion {
      package = finalAttrs.finalPackage;
      command = "vocat version";
    };
  };

  meta = {
    description = "Web control panel and engineering toolkit for Quectel EC20/EC25-class and China Mobile ML307 series cellular modems";
    longDescription = ''
      It combines modem discovery, live radio status, AT and USSD terminals, SMS,
      WiFi Calling, eSIM management, network selection, proxy routing,
      notifications, audit logs, and release automation in one self-contained
      service.

      The backend is written in Go, the interface is built with React and
      TypeScript, and the production frontend is embedded into the Go binary.
      A single executable contains the web application and uses SQLite for
      persistent state.
    '';
    homepage = "https://github.com/MengMengCode/VoCat";
    changelog = "https://github.com/MengMengCode/VoCat/releases/tag/v${finalAttrs.version}";
    # Vocat Research & Evaluation License 1.0.
    license = lib.licenses.unfree;
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "vocat";
    platforms = lib.platforms.linux;
  };
})
