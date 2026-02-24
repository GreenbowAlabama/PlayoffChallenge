#!/bin/bash
# CLIENT LOCK V1 - Manual iOS Contract Validation
# Run this to validate core contracts and strict decoding rules

# Navigate to core package
cd ../core || { echo "Error: core directory not found"; exit 1; }

# Build core package
echo "Building core package..."
swift build

# Run all strict contract tests and output to docs/ios_contract_validation.txt
echo "Running strict contract tests..."
swift test > ../docs/ios_contract_validation.txt 2>&1

# Report result
echo "Validation complete. Output saved to docs/ios_contract_validation.txt"
echo "Tail of output:"
tail -20 ../docs/ios_contract_validation.txt
