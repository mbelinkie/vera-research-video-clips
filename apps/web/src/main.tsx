import { desktopBridge } from "./api-client.ts";

if (desktopBridge()) {
  void import("./desktop-main.tsx");
} else {
  void import("./hosted-main.tsx");
}
