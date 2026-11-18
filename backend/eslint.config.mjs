import base from "../frontend/eslint.config.mjs";

// Same rules as the frontend; the backend has no pages directory, so that Next rule doesn't apply.
export default [...base, { rules: { "@next/next/no-html-link-for-pages": "off" } }];
