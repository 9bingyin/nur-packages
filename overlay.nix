# Flat NUR-compatible overlay. Packages are exposed at top level, e.g. pkgs.longbridge.
_self: super:
let
  reservedNames = [
    "lib"
    "overlays"
    "nixosModules"
    "homeModules"
    "darwinModules"
    "flakeModules"
    "default"
  ];

  packageSet = import ./default.nix { pkgs = super; };

  packageNames = builtins.filter (name: !(builtins.elem name reservedNames)) (
    builtins.attrNames packageSet
  );
in
builtins.listToAttrs (
  map (name: {
    inherit name;
    value = packageSet.${name};
  }) packageNames
)
