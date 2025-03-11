#!/bin/bash

# Set extension name
EXTENSION_NAME="SpaceLLama"

# Create a temporary directory for building
BUILD_DIR="./build"
mkdir -p $BUILD_DIR

# Copy all necessary files to the build directory
echo "Copying files to build directory..."
cp -r background.js content_scripts icon.png manifest.json options sidebar model_tokens.json $BUILD_DIR

# Navigate to the build directory
cd $BUILD_DIR

# Create the XPI file (which is just a ZIP file with .xpi extension)
echo "Creating XPI file..."
zip -r ../${EXTENSION_NAME}.xpi *

# Clean up
cd ..
echo "Cleaning up build directory..."
rm -rf $BUILD_DIR

echo "XPI file created: ${EXTENSION_NAME}.xpi"