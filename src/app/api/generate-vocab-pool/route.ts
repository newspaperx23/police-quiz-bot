import { NextRequest } from "next/server";
import { db } from "@/lib/firebase";
import OpenAI from "openai";

export const dynamic = "force-dynamic";

interface GeneratedVocab {
  word: string;
  partOfSpeech: string;
  pronunciation: string;
  translation: string;
  exampleEng: string;
  exampleThai: string;
}

/**
 * GET/POST /api/generate-vocab-pool
 * Generates a batch of Oxford 3000 vocabulary words and saves them to the global pool.
 * Secured by ADMIN_PASSWORD bearer token.
 */
export async function GET(request: Request) {
  try {
    // Auth Check
    const authHeader = request.headers.get("authorization");
    const adminPassword = process.env.ADMIN_PASSWORD || "!159951zZ";
    if (!authHeader || authHeader !== `Bearer ${adminPassword}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const countParam = parseInt(searchParams.get("count") || "5", 10);

    // Limit count to prevent serverless function timeout (max 10)
    const count = Math.min(Math.max(countParam, 1), 10);

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Fetch existing words in the pool to prevent duplicates
    let pastWordsText = "";
    try {
      const existingSnapshot = await db
        .collection("global_vocabulary")
        .limit(100)
        .get();
      if (!existingSnapshot.empty) {
        const pastWords = existingSnapshot.docs.map((doc) => doc.data().word);
        pastWordsText = `\nห้ามเลือกคำศัพท์ภาษาอังกฤษที่มีคำเหล่านี้อยู่ในคลังแล้วเด็ดขาด:\n${pastWords.join(", ")}`;
      }
    } catch (err) {
      console.error("Failed to fetch existing global_vocabulary:", err);
    }

    const prompt = `คุณคืออาจารย์ผู้เชี่ยวชาญวิชาภาษาอังกฤษสำหรับการสอบตำรวจไทย (สายอำนวยการ)
สุ่มเลือกคำศัพท์ระดับปานกลางถึงยาก (ระดับ A2, B1, B2) จำนวน ${count} คำจากรายการ Oxford 3000 List

ห้ามเลือกคำศัพท์พื้นฐานเกินไป (เช่น a, an, the, and, apple, book, day, go, get) และใช้เงื่อนไขต่อไปนี้:${pastWordsText}

ตอบกลับเป็นรูปแบบ JSON Object เท่านั้น มีโครงสร้างดังนี้:
{
  "vocabularies": [
    {
      "word": "คำศัพท์ภาษาอังกฤษ (ขึ้นต้นด้วยตัวใหญ่)",
      "partOfSpeech": "ชนิดของคำ เช่น verb, noun, adjective",
      "pronunciation": "คำอ่านคำสะกดไทย เช่น อะ-แบน-เดิน",
      "translation": "คำแปลภาษาไทยที่กระชับและถูกต้อง",
      "exampleEng": "ประโยคตัวอย่างภาษาอังกฤษสั้นๆ ที่เข้าใจง่าย",
      "exampleThai": "คำแปลประโยคตัวอย่างภาษาไทย"
    },
    ...
  ]
}

กฎสำคัญมาก (ต้องปฏิบัติทุกข้อ):
1. คำศัพท์ต้องสะกดอย่างถูกต้อง
2. ประโยคตัวอย่างต้องใช้คำศัพท์นั้นในรูปคำที่เหมาะสม
3. ห้ามมีฟอร์แมตอื่นใดนอกเหนือจาก JSON object ดังกล่าว`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.85,
      max_tokens: 3000,
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      throw new Error("Empty response from OpenAI");
    }

    const data = JSON.parse(raw);
    const vocabularies: GeneratedVocab[] = data.vocabularies || [];

    if (!Array.isArray(vocabularies) || vocabularies.length === 0) {
      throw new Error("No vocabularies generated or invalid format");
    }

    let savedCount = 0;
    let skippedCount = 0;
    const batch = db.batch();

    for (const v of vocabularies) {
      // Basic structural validation
      if (
        !v.word ||
        !v.partOfSpeech ||
        !v.pronunciation ||
        !v.translation ||
        !v.exampleEng ||
        !v.exampleThai
      ) {
        console.warn(`Skipping vocab with invalid structure: ${v.word}`);
        skippedCount++;
        continue;
      }

      const docRef = db.collection("global_vocabulary").doc();
      batch.set(docRef, {
        word: v.word.trim(),
        partOfSpeech: v.partOfSpeech.trim(),
        pronunciation: v.pronunciation.trim(),
        translation: v.translation.trim(),
        exampleEng: v.exampleEng.trim(),
        exampleThai: v.exampleThai.trim(),
        createdAt: new Date(),
      });
      savedCount++;
    }

    if (savedCount > 0) {
      await batch.commit();
    }

    return Response.json({
      success: true,
      requestedCount: count,
      savedCount,
      skippedCount,
    });
  } catch (error) {
    console.error("Generate vocab pool API error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to generate vocabulary pool" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  return GET(request);
}
