mkdir -p build
cp -r brave node_modules index.mjs build/
find build/node_modules -type f -name "*.md" -delete
find build/node_modules -type d -name "test" | xargs rm -rf
cd build/
zip -r ./test.zip *
