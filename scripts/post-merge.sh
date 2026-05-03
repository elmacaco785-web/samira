#!/bin/bash
set -e

# MozPay post-merge setup
# Pure Node.js/vanilla app — no build step, no package install needed.
# Just verify node is available and the server entrypoint exists.

node --version
test -f server.js
echo "post-merge setup OK"
