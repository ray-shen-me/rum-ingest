// Seed the sites/ray-shen-me registry document (task 2.2, design D5).
//
// Usage (with ADC or a project set):
//   GOOGLE_CLOUD_PROJECT=<project> npm run seed
//
// Idempotent: re-running overwrites the site doc with the same content.

import { db } from '../src/firestore.js';
import type { SiteDoc } from '../src/types.js';

const SITE_ID = 'ray-shen-me';
const site: SiteDoc = {
  name: 'ray-shen.me',
  // Ordered sections drive funnel ordering and max_section resolution (D5).
  sections: ['hero', 'about', 'experience', 'projects', 'contact'],
};

async function main(): Promise<void> {
  await db().collection('sites').doc(SITE_ID).set(site);
  console.log(`Seeded sites/${SITE_ID}:`, JSON.stringify(site));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
