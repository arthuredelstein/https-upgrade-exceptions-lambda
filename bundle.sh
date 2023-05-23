rm -rf build
mkdir -p build
cp -r index.mjs util.mjs collect.mjs feed.mjs brave/ build/
cd build/
zip -r ../test.zip *
