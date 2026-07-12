import { NextRequest } from "next/server";
import { db } from "@/lib/firebase";
import { sendIndividualVocabulary } from "@/lib/vocabulary";

export const dynamic = "force-dynamic";

/**
 * GET/POST /api/send-vocabulary
 * Scheduled vocabulary dispatcher. Secured by CRON_SECRET bearer token.
 * Sends vocabulary to ALL users every 1 hour — regardless of sleep mode.
 * (Quiz delivery respects sleep mode, but vocabulary is always sent 24/7)
 */
export async function GET(request: NextRequest) {
  return handleDispatch(request);
}

export async function POST(request: NextRequest) {
  return handleDispatch(request);
}

async function handleDispatch(request: NextRequest) {
  try {
    // ─── Auth check (supports Vercel Cron, GitHub Actions, and Admin Dashboard) ──
    const authHeader = request.headers.get("authorization");
    const expectedCronToken = `Bearer ${process.env.CRON_SECRET}`;
    const expectedAdminToken = `Bearer ${process.env.ADMIN_PASSWORD}`;
    const isVercelCron = request.headers.get("x-vercel-cron") === "true";

    const isAuthorized =
      isVercelCron ||
      authHeader === expectedCronToken ||
      (process.env.ADMIN_PASSWORD && authHeader === expectedAdminToken);

    if (!isAuthorized) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ─── Fetch ALL users (send vocabulary 24/7 regardless of sleep mode) ──
    const snapshot = await db
      .collection("users")
      .get();

    if (snapshot.empty) {
      return Response.json({ message: "No users", sent: 0 });
    }

    let sentCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    const now = Date.now();
    const intervalMs = 60 * 60 * 1000; // 1 hour in milliseconds

    // ─── Process each user ────────────────────────────
    for (const doc of snapshot.docs) {
      const chatId = doc.id;
      const userData = doc.data();

      const lastVocabAt = userData.lastVocabAt ? userData.lastVocabAt.toDate().getTime() : 0;
      const msPassed = now - lastVocabAt;
      
      // Buffer of 15 seconds to prevent issues with minor cron trigger delay
      const isTime = lastVocabAt === 0 || msPassed >= (intervalMs - 15000);

      if (!isTime) {
        skippedCount++;
        continue;
      }

      try {
        const success = await sendIndividualVocabulary(chatId);
        if (success) {
          sentCount++;
        } else {
          errorCount++;
        }
      } catch (userError) {
        console.error(`Error sending vocabulary to user ${chatId}:`, userError);
        errorCount++;
      }

      // Rate limit: 150ms delay between users
      await new Promise((r) => setTimeout(r, 150));
    }

    return Response.json({
      message: "Vocabulary dispatch complete (24/7 mode)",
      sent: sentCount,
      errors: errorCount,
      skipped: skippedCount,
      total: snapshot.size,
    });
  } catch (error) {
    console.error("Vocabulary dispatch error:", error);
    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
