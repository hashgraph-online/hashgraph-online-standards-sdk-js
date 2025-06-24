#!/bin/bash

# Build the WASM module
wasm-pack build --target web --out-dir pkg

# Optimize the WASM file
wasm-opt pkg/hashlink_counter_bg.wasm -Oz -o pkg/hashlink_counter_bg_optimized.wasm

echo "Build complete! WASM module available at pkg/"