{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = [
    (pkgs.python312.withPackages (ps: with ps; [
      streamlit
      pandas
      altair
      plotly
      python-dateutil
      pytest
    ]))
    pkgs.nodejs
  ];

  shellHook = ''
    # Fix npm/npx path issues on Nix
    export NPM_CONFIG_PREFIX=$PWD/.npm-global
    export PATH=$PWD/.npm-global/bin:$PATH
    export npm_config_cache=$PWD/.npm-cache
    
    # Ensure the full structure exists
    mkdir -p .npm-global/lib .npm-cache

    echo "Actual Budget Dashboard Dev Shell"
    echo "Python $(python --version)"
    echo "Node $(node --version)"
    
    if ! command -v actual &> /dev/null; then
      echo "Installing Actual dependencies locally..."
      npm install -g @actual-app/cli @actual-app/api --quiet
    fi

    echo "Actual CLI $(actual --version)"
    echo "Run with: streamlit run app.py"
  '';
}
