module.exports = {
  packagerConfig: {
    name: "Research Video Clips",
    executableName: "research-video-clips",
    appBundleId: "com.researchvideoclips.desktop",
    appCategoryType: "public.app-category.productivity",
    asar: true,
    osxSign: false,
    extendInfo: {
      CFBundleDisplayName: "Research Video Clips",
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: false,
        NSAllowsLocalNetworking: true,
      },
    },
    protocols: [
      {
        name: "Research Video Clips authentication callback",
        schemes: ["research-video-clips"],
      },
    ],
    ignore: [/^\/(?!dist(?:\/|$)|package\.json$).+/],
  },
  makers: [],
};
