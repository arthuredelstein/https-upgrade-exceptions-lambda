rm -rf build
rm ./test.zip
mkdir -p build
cp -r index.mjs util.mjs collect.mjs feed.mjs s3.mjs brave/ build/
cd build/
zip -r ../test.zip *
