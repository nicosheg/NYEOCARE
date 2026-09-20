/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Add redirects for old routes to new consolidated surfaces
  async redirects() {
    return [
      // Scan remains a full page – redirect old /scan to Home (which has a Scan Register button)
      { source: '/scan', destination: '/', permanent: false },

      // Attendance → People → Attendance tab
      { source: '/attendance', destination: '/people?tab=attendance', permanent: false },

      // Care Queue → Home (integrated)
      { source: '/care-queue', destination: '/', permanent: false },

      // Community → People → Community tab
      { source: '/community', destination: '/people?tab=community', permanent: false },

      // Review Center → People → Review tab (handle both file names)
      { source: '/review-center', destination: '/people?review=1', permanent: false },
      { source: '/reviewer-center', destination: '/people?review=1', permanent: false },

      // Church Profile → Profile
      { source: '/church-profile', destination: '/profile', permanent: false },
    ];
  },
};

module.exports = nextConfig;
