const { CapacitorConfig } = require("@capacitor/cli");

const config = {
  appId: "com.nyeocare.app",
  appName: "NYEOCARE",
  webDir: "public",
  server: {
    url: "https://nyeocare.vercel.app",
    cleartext: false
  },
  android: {
    allowMixedContent: false
  }
};

module.exports = config;
