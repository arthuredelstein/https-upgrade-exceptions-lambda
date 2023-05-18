mkdir -p build-layer/nodejs
cp -r node_modules build-layer/nodejs/
find build-layer/node_modules/nodejs -type f -name "*.md" -delete
find build-layer/node_modules/nodejs -type d -name "test" | xargs rm -rf
cd build-layer
zip -r ../layer.zip *
