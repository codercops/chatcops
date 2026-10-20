---
"@chatcops/widget": patch
---

Remove the `require` export condition. It pointed at the script tag bundle, which never sets `module.exports`, so `require('@chatcops/widget')` returned an empty object. CommonJS code now gets a clear `ERR_PACKAGE_PATH_NOT_EXPORTED` error; use `import` instead. The `main` field and the `dist/chatcops.min.js` file that the CDN snippet loads are unchanged. The build also always writes the type declarations now, even after an earlier local build.
