rm -rf build
mkdir -p build
cp -r index.mjs collect.mjs build/
cd build/
zip -r ../test.zip *
