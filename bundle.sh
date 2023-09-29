rm -rf build
rm ./test.zip
mkdir -p build
cp -a index.mjs util.mjs feed.mjs analysis.mjs brave build/
cd build/
zip -r ../test.zip *
