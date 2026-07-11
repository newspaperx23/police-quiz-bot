import { initializeApp, getApps, cert, type ServiceAccount } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

let firestoreInstance: ReturnType<typeof getFirestore> | null = null;

export const db = new Proxy({} as ReturnType<typeof getFirestore>, {
  get(target, prop, receiver) {
    if (!firestoreInstance) {
      if (!getApps().length) {
        const projectId = process.env.FIREBASE_PROJECT_ID;
        const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
        const privateKey = process.env.FIREBASE_PRIVATE_KEY;

        if (!projectId || !clientEmail || !privateKey) {
          throw new Error(
            "Firebase credentials are not set. Please configure FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY."
          );
        }

        const serviceAccount: ServiceAccount = {
          projectId,
          clientEmail,
          privateKey: privateKey.replace(/\\n/g, "\n"),
        };
        initializeApp({ credential: cert(serviceAccount) });
      }
      firestoreInstance = getFirestore();
    }
    return Reflect.get(firestoreInstance, prop, receiver);
  },
});

