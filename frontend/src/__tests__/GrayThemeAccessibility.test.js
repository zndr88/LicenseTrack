import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

const foundationCss = readFileSync("src/styles/foundation.css", "utf8");

function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [
    (value >> 16) & 255,
    (value >> 8) & 255,
    value & 255,
  ];
}

function relativeLuminance(hex) {
  const channels = hexToRgb(hex).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return (
    channels[0] * 0.2126
    + channels[1] * 0.7152
    + channels[2] * 0.0722
  );
}

function contrastRatio(foreground, background) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function token(block, name) {
  return block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
}

describe("default gray theme accessibility", () => {
  test("secondary and semantic text tokens meet WCAG AA on the lightest gray surface", () => {
    const background = token(foundationCss, "bg-3");
    const foregroundTokens = [
      "text-1",
      "text-2",
      "text-3",
      "green",
      "green-text",
      "orange",
      "orange-text",
      "red",
      "red-text",
      "purple",
      "purple-text",
      "steel",
      "steel-text",
    ];

    for (const name of foregroundTokens) {
      const foreground = token(foundationCss, name);
      expect(foreground, `${name} should be a six-digit hex token`).toBeTruthy();
      expect(
        contrastRatio(foreground, background),
        `${name} should meet 4.5:1 against bg-3`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
