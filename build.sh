#!/bin/sh
# Build FnTV.wgt from the app/ sources.
# The widget files must sit at the zip root (config.xml at the top level),
# otherwise the TV refuses the package ("No target entry found").
set -e
cd "$(dirname "$0")/app"
rm -f ../FnTV.wgt
zip -r -X ../FnTV.wgt config.xml index.html style.css app.js fnapi.js md5.js sha1.js icon.png
echo "Built ../FnTV.wgt"
