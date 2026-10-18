import { describe, expect, it } from "vitest";

import { supportedSourceExtensions } from "../src/index.js";

describe("worker package boundary", () => {
  it("declares the supported source extensions", () => {
    expect(supportedSourceExtensions).toEqual([
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".py",
      ".java",
      ".c",
      ".h",
      ".cc",
      ".cpp",
      ".cxx",
      ".hpp",
      ".go",
    ]);
  });
});
