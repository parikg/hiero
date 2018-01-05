#!/bin/bash
# A small shell script which rebuilds both projects that compose Hillview

# Bail out on first error
set -e

export MAVEN_OPTS="-Xmx2048M"
pushd ../platform
mvn install
popd
pushd ../web
mvn package
popd
