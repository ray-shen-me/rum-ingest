// Firestore Admin initialization.
//
// On Cloud Run the Admin SDK picks up credentials from the attached service
// account via Application Default Credentials / Workload Identity (task 1.7) —
// no key file is ever needed or committed.

import admin from 'firebase-admin';
import { config } from './config.js';

let app: admin.app.App | undefined;

export function getApp(): admin.app.App {
  if (!app) {
    app = admin.initializeApp(
      config.projectId ? { projectId: config.projectId } : undefined,
    );
  }
  return app;
}

export function db(): FirebaseFirestore.Firestore {
  return getApp().firestore();
}

export function auth(): admin.auth.Auth {
  return getApp().auth();
}

/** Firestore Timestamp helper. */
export const Timestamp = admin.firestore.Timestamp;
