#!/usr/bin/env node
import { randomBytes } from 'node:crypto';

// Generate a high-entropy remote MCP bearer token. Store it in the hosting
// provider's secret environment settings; do not commit it to source control.
console.log(randomBytes(48).toString('base64url'));
