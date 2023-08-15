rm -rf build
rm ./test.zip
mkdir -p build
cp -a index.mjs util.mjs feed.mjs s3.mjs brave build/
cd build/
zip -r ../test.zip *
