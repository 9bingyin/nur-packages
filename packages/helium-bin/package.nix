{
  lib,
  stdenv,
  callPackage,
  makeWrapper,
  wrapGAppsHook3,
  qt6,
  glib,
  gtk3,
  gtk4,
  gsettings-desktop-schemas,
  adwaita-icon-theme,
  pipewire,
  xdg-utils,
  coreutils,
  commandLineArgs ? "",
}:
let
  unwrapped = callPackage ./unwrapped.nix { };
  executable =
    if stdenv.hostPlatform.isDarwin then
      "${unwrapped}/Applications/Helium.app/Contents/MacOS/Helium"
    else
      "${unwrapped}/lib/helium/helium";
  extraFlagArgs = lib.optionalString (
    commandLineArgs != ""
  ) " \\\n  --add-flags ${lib.escapeShellArg commandLineArgs}";
in
stdenv.mkDerivation {
  pname = "helium-bin";
  inherit (unwrapped) version;

  dontUnpack = true;
  dontConfigure = true;
  dontBuild = true;
  dontWrapGApps = true;
  dontWrapQtApps = true;

  nativeBuildInputs = [
    makeWrapper
  ]
  ++ lib.optionals stdenv.hostPlatform.isLinux [
    wrapGAppsHook3
    qt6.wrapQtAppsHook
  ];

  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [
    # Setup hooks populate the GApp and Qt wrapper arguments.
    glib
    gtk3
    gtk4
    gsettings-desktop-schemas
    adwaita-icon-theme
    pipewire
    qt6.qtbase
    qt6.qtwayland
  ];

  installPhase =
    if stdenv.hostPlatform.isDarwin then
      ''
        runHook preInstall

        mkdir -p "$out/Applications" "$out/bin"
        ln -s "${unwrapped}/Applications/Helium.app" "$out/Applications/Helium.app"
        makeWrapper "${executable}" "$out/bin/helium" \
          --add-flags "--simulate-outdated-no-au='Tue, 31 Dec 2099 23:59:59 GMT'"${extraFlagArgs}

        runHook postInstall
      ''
    else
      ''
        runHook preInstall

        mkdir -p "$out/bin"
        install -Dm644 "${unwrapped}/lib/helium/helium.desktop" "$out/share/applications/helium.desktop"
        install -Dm644 "${unwrapped}/lib/helium/product_logo_256.png" \
          "$out/share/icons/hicolor/256x256/apps/helium.png"
        substituteInPlace "$out/share/applications/helium.desktop" \
          --replace-fail 'Exec=helium' "Exec=$out/bin/helium"

        runHook postInstall
      '';

  preFixup = lib.optionalString stdenv.hostPlatform.isLinux ''
    makeShellWrapper "${executable}" "$out/bin/helium" \
      "''${gappsWrapperArgs[@]}" \
      "''${qtWrapperArgs[@]}" \
      --set CHROME_WRAPPER "$out/bin/helium" \
      --set CHROME_VERSION_EXTRA nix \
      --prefix PATH : "${
        lib.makeBinPath [
          xdg-utils
          coreutils
        ]
      }" \
      --prefix LD_LIBRARY_PATH : "${unwrapped}/lib/helium:${lib.makeLibraryPath unwrapped.runtimeLibraries}" \
      --add-flags "--simulate-outdated-no-au='Tue, 31 Dec 2099 23:59:59 GMT'" \
      --add-flags "\''${NIXOS_OZONE_WL:+\''${WAYLAND_DISPLAY:+--ozone-platform-hint=auto}}"${extraFlagArgs}
  '';

  doInstallCheck = stdenv.hostPlatform.isLinux;
  installCheckPhase = ''
    runHook preInstallCheck
    HOME="$TMPDIR" "$out/bin/helium" --version
    runHook postInstallCheck
  '';

  preferLocalBuild = true;

  passthru = {
    inherit unwrapped;
    updateScript = {
      command = [ ./update.ts ];
      supportedFeatures = [
        "commit"
        "same-version"
      ];
    };
  };

  meta = unwrapped.meta // {
    priority = (unwrapped.meta.priority or lib.meta.defaultPriority) - 1;
  };
}
