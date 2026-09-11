#!/bin/bash
# Safe npm publish — prevents ghost versions from burning version numbers.
#
# Strategy:
# 1. Pre-check: verify version doesn't already exist on npm
# 2. Dry-run: validate package before uploading
# 3. Publish with retry: if ghost detected, unpublish + retry once
# 4. If still blocked (24hr cooldown), bump patch and retry
set -e

PKG_NAME=$(node -p "require('./package.json').name")
PKG_VERSION=$(node -p "require('./package.json').version")

echo "Publishing ${PKG_NAME}@${PKG_VERSION}..."

# Step 0: Auth first. npm reports an expired or missing token on publish as
# "404 '<pkg>@<version>' is not in this registry", which the ghost logic below
# used to misread as a burned version (and then tried to unpublish). An auth
# failure is not a ghost: stop before anything touches the registry.
if ! npm whoami >/dev/null 2>&1; then
    echo "ERROR: npm is not authenticated (npm whoami failed). This is NOT a ghost version."
    echo "Renew the granular access token (npmjs.com -> Access Tokens), update ~/.npmrc, re-run."
    exit 3
fi

# Step 1: Check if version already exists on npm
if npm view "${PKG_NAME}@${PKG_VERSION}" version 2>/dev/null; then
    echo "ERROR: ${PKG_NAME}@${PKG_VERSION} already exists on npm."
    echo "Bump the version first: npm version patch --no-git-tag-version"
    exit 1
fi

# Step 2: Dry-run to catch errors before uploading
echo "Running dry-run..."
if ! npm publish --dry-run 2>&1; then
    echo "ERROR: Dry-run failed. Fix issues before publishing."
    exit 1
fi

# Step 3: Actual publish
echo "Publishing..."
if npm publish 2>&1; then
    echo "Successfully published ${PKG_NAME}@${PKG_VERSION}"
    exit 0
fi

# Step 4: Publish failed — check for ghost version
echo "Publish failed. Checking for ghost version..."
sleep 5

if ! npm whoami >/dev/null 2>&1; then
    echo "ERROR: npm authentication failed during publish. This is NOT a ghost version; nothing was consumed."
    exit 3
fi

if npm view "${PKG_NAME}@${PKG_VERSION}" version 2>/dev/null; then
    echo "Version was actually published (delayed propagation). Success!"
    exit 0
fi

# Ghost detected: version rejected but consumed
echo "Ghost version detected. Attempting unpublish + retry..."
if npm unpublish "${PKG_NAME}@${PKG_VERSION}" 2>/dev/null; then
    sleep 3
    if npm publish 2>&1; then
        echo "Successfully published ${PKG_NAME}@${PKG_VERSION} after ghost recovery."
        exit 0
    fi
fi

# Unpublish failed or republish blocked (24hr cooldown)
echo ""
echo "GHOST VERSION BURNED: ${PKG_NAME}@${PKG_VERSION}"
echo ""
echo "npm's 24-hour cooldown prevents reuse. Options:"
echo "  1. Bump patch:  npm version patch --no-git-tag-version"
echo "  2. Wait 24 hours and retry"
exit 1
