import type { MetadataRoute } from 'next';

/**
 * Makes the app installable ("Add to Home Screen"). On iPhone that is what
 * allows reminder notifications at all.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Tracker26',
    short_name: 'Tracker26',
    description: 'Personal finance tracker',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0a0b0d',
    theme_color: '#0a0b0d',
    icons: [
      { src: '/icon', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png', purpose: 'any' },
    ],
  };
}
