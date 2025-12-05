# This file defines tests for all packages in the repository
# Tests are automatically generated for all non-reserved packages
{ pkgs ? import <nixpkgs> { config.allowUnfree = true; } }:

with builtins;
let
  nurPkgs = import ./default.nix { inherit pkgs; };

  # Reserved attribute names that are not packages
  isReserved = n: n == "lib" || n == "overlays" || n == "modules";

  # Check if an attribute is a derivation (actual package)
  isDerivation = p: isAttrs p && p ? type && p.type == "derivation";

  # Get all package names (non-reserved attributes that are derivations)
  packageNames = filter (n: !isReserved n && isDerivation nurPkgs.${n}) (attrNames nurPkgs);

  # Test that a package builds and has correct metadata
  testPackage = name: pkg:
    pkgs.runCommand "test-${name}" { } ''
      # Check that package exists and is a valid derivation
      test -n "${pkg}"

      # Check that package has required metadata
      ${if pkg.meta ? description then ''
        echo "✓ ${name}: has description"
      '' else ''
        echo "✗ ${name}: missing description"
        exit 1
      ''}

      ${if pkg.meta ? license then ''
        echo "✓ ${name}: has license"
      '' else ''
        echo "✗ ${name}: missing license"
        exit 1
      ''}

      ${if pkg.meta ? mainProgram then ''
        echo "✓ ${name}: has mainProgram"
      '' else ''
        echo "✓ ${name}: no mainProgram (might be a library)"
      ''}

      ${if pkg.meta ? platforms then ''
        echo "✓ ${name}: has platforms"
      '' else ''
        echo "✗ ${name}: missing platforms"
        exit 1
      ''}

      mkdir -p $out
      echo "All metadata tests passed for ${name}" > $out/result
    '';

  # Test that a binary package can be executed
  testBinary = name: pkg:
    pkgs.runCommand "test-binary-${name}" {
      buildInputs = [ pkg ];
    } ''
      # Check that the main program exists
      MAIN_PROG="${pkg.meta.mainProgram or name}"

      if command -v "$MAIN_PROG" &> /dev/null; then
        echo "✓ ${name}: binary '$MAIN_PROG' is available in PATH"

        # Try to get version or help (non-critical, some programs might not support it)
        if "$MAIN_PROG" --version &> /dev/null || "$MAIN_PROG" --help &> /dev/null || "$MAIN_PROG" -h &> /dev/null; then
          echo "✓ ${name}: binary responds to --version, --help, or -h"
        else
          echo "⚠ ${name}: binary doesn't respond to common flags (might be expected)"
        fi
      else
        echo "✗ ${name}: binary '$MAIN_PROG' not found in PATH"
        exit 1
      fi

      mkdir -p $out
      echo "Binary tests passed for ${name}" > $out/result
    '';

  # Test installation
  testInstall = name: pkg:
    pkgs.runCommand "test-install-${name}" { } ''
      # Check that key paths exist
      test -d "${pkg}"
      echo "✓ ${name}: package output directory exists"

      ${if pkg.meta ? mainProgram then ''
        test -f "${pkg}/bin/${pkg.meta.mainProgram}"
        echo "✓ ${name}: main program binary exists at ${pkg}/bin/${pkg.meta.mainProgram}"
      '' else ''
        echo "⚠ ${name}: no mainProgram defined, skipping binary check"
      ''}

      mkdir -p $out
      echo "Installation tests passed for ${name}" > $out/result
    '';

  # Helper to create attribute set from list of names
  nameValuePair = n: v: { name = n; value = v; };

  # Generate tests for all packages
  genMetadataTests = listToAttrs (map (name: nameValuePair name (testPackage name nurPkgs.${name})) packageNames);

  genInstallTests = listToAttrs (map (name: nameValuePair name (testInstall name nurPkgs.${name})) packageNames);

  # Binary tests - skip GUI apps that require X11
  # You can customize this list based on your packages
  skipBinaryTest = name:
    # longbridge is a GUI app that requires X11, skip it
    name == "longbridge";

  binaryTestPackages = filter (name: !skipBinaryTest name) packageNames;
  genBinaryTests = listToAttrs (map (name: nameValuePair name (testBinary name nurPkgs.${name})) binaryTestPackages);

in
rec {
  # Metadata tests for all packages
  metadata = genMetadataTests;

  # Binary execution tests (excluding GUI apps)
  binaries = genBinaryTests;

  # Installation tests
  install = genInstallTests;

  # Combine all tests
  all = pkgs.symlinkJoin {
    name = "all-package-tests";
    paths =
      (pkgs.lib.attrValues metadata) ++
      (pkgs.lib.attrValues binaries) ++
      (pkgs.lib.attrValues install);
  };

  # Export package list for use in CI
  packageNamesList = packageNames;
}
