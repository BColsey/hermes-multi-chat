import { MultiChat } from "./App";
import { React, sdk } from "./sdk";
function CompatibilityError() {
  return React.createElement(
    "div",
    { role: "alert" },
    "Multi Chat requires Hermes Dashboard SDK 1.1.x with fetchJSON and buildWsUrl. No terminal was opened.",
  );
}
window.__HERMES_PLUGINS__?.register(
  "multi-chat",
  sdk?.React &&
    typeof sdk.fetchJSON === "function" &&
    typeof sdk.buildWsUrl === "function" &&
    sdk.sdkVersion?.startsWith("1.")
    ? MultiChat
    : CompatibilityError,
);
