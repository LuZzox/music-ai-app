#!/bin/bash
# Install dependencies
npm install --save-dev prettier eslint eslint-config-prettier eslint-plugin-node

# Format all files
npm run format

# Check linting
npm run lint
