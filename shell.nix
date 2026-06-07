let
  lock = builtins.fromJSON (builtins.readFile ./flake.lock);
  bootstrap = fetchTarball {
    url = "https://github.com/edolstra/flake-compat/archive/master.tar.gz";
  };
  flake = import bootstrap { src = ./.; };
in
flake.shellNix
