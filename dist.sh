cd dist
tar -cvf dist.tar vite.svg index.html assets
scp dist.tar integ@10.227.188.40:/tmp/ 
cd -
