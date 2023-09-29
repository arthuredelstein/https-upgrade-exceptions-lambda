rm -rf build
mkdir -p build
cp -r feed.mjs util.mjs brave build/
cd build/
zip -r ../feed.zip *
