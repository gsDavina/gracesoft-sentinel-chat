import base from "@gracesoft-sentinel/config-eslint";

// `public/` is plain browser JS served as a static asset, not part of the
// TypeScript build — it isn't Node code, so the shared Node-oriented base
// config's globals don't apply to it.
export default [...base, { ignores: ["public/**"] }];
