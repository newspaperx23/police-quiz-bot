import { NextRequest } from "next/server";
import { sendIndividualQuiz } from "@/lib/quiz";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const result = await sendIndividualQuiz("2081311189", "คอมพิวเตอร์", 0);
    return Response.json({
      success: result,
      env: {
        hasOpenAI: !!process.env.OPENAI_API_KEY,
        openaiLen: process.env.OPENAI_API_KEY?.length || 0,
        hasTelegram: !!process.env.TELEGRAM_BOT_TOKEN,
        telegramLen: process.env.TELEGRAM_BOT_TOKEN?.length || 0,
        hasFirebaseId: !!process.env.FIREBASE_PROJECT_ID,
        firebaseIdLen: process.env.FIREBASE_PROJECT_ID?.length || 0,
      }
    });
  } catch (error) {
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}
