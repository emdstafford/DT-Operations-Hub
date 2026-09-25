import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DT Intelligence Hub",
    short_name: "DT Hub",
    description: "Davenport Transportation reporting and operations",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#102d49",
    icons: [{ src: "/logo.png", sizes: "510x456", type: "image/png" }],
  };
}
