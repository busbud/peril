module.exports = function(wallaby) {
  return {
    files: [
      "tsconfig.json",
      "jsconfig.json",
      ".env.sample",
      "source/testing/setupScript.js",
      "source/**/*.ts?(x)",
      "source/**/*.snap",
      "source/**/*.json",
      "source/**/*.diff",
      "!source/**/*.test.ts?(x)",
    ],
    tests: ["source/**/*.test.ts?(x)"],

    preprocessors: {
      "**/*.js": file =>
        require("babel-core").transform(file.content, { sourceMap: true, presets: ["babel-preset-jest"] }),
    },

    env: {
      type: "node",
      runner: "node",
    },

    testFramework: "jest",
  }
}
