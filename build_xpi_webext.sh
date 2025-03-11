#!/bin/bash

# Build the extension using web-ext
web-ext build --source-dir ./ --artifacts-dir ./dist --overwrite-dest

echo "XPI file created in ./dist directory"