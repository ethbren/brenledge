bash
# 1. Install/switch to a supported Node version
nvm install 20
nvm use 20
node -v     # should print v20.x — confirm before moving on
npm -v      # should be 10.x, not 8.1.2

curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash


Ran to make nvx work 
ethanbrenny@Ethans-MacBook-Pro coding % export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion

