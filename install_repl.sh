#!/bin/bash
echo "Downloading files..."
git clone https://github.com/greysoh/incenerator.git 
cp -r incenerator/* .
rm -rf incenerator
echo "#!/bin/bash" > local32.sh
echo "npm install" >> local32.sh
echo "sed -i 's/bash local32.sh/node index.js/g' .replit" >> local32.sh
echo "rm -rf local32.sh" >> local32.sh
echo "Modifing initialization files..."
sed -i 's/cowsay Configure me!/bash local32.sh/g' .replit
sed -i 's/pkgs.cowsay/pkgs.nodejs-16_x/g' replit.nix 
echo "Forcing reload..."
kill 1