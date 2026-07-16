import { db } from "./firebase";
import { sendMessage } from "./telegram";
import OpenAI from "openai";

/**
 * Generates vocabulary on-the-fly via OpenAI as a fallback.
 */
async function generateOnTheFly(pastWords: string[]): Promise<any> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const negativeConstraint = pastWords.length > 0 
    ? `\nห้ามเลือกคำศัพท์เหล่านี้อย่างเด็ดขาดเนื่องจากเพิ่งถูกส่งไปเมื่อเร็วๆ นี้:\n${pastWords.join(", ")}` 
    : "";

  const prompt = `คุณคืออาจารย์ผู้เชี่ยวชาญวิชาภาษาอังกฤษสำหรับการสอบตำรวจไทย (สายอำนวยการ)
สุ่มเลือกคำศัพท์ระดับปานกลางถึงยาก (ระดับ A2, B1, B2) จำนวน 1 คำจากรายการ Oxford 3000 List

ห้ามเลือกคำศัพท์พื้นฐานเกินไป (เช่น a, an, the, and, apple, book, day, go, get) และใช้เงื่อนไขต่อไปนี้:${negativeConstraint}

ตอบกลับเป็น JSON Object เท่านั้น:
{
  "word": "คำศัพท์ภาษาอังกฤษ (ขึ้นต้นด้วยตัวใหญ่)",
  "partOfSpeech": "ชนิดของคำ เช่น verb, noun, adjective",
  "pronunciation": "คำอ่านคำสะกดไทย เช่น อะ-แบน-เดิน",
  "translation": "คำแปลภาษาไทยที่กระชับและถูกต้อง",
  "exampleEng": "ประโยคตัวอย่างภาษาอังกฤษสั้นๆ ที่เข้าใจง่าย",
  "exampleThai": "คำแปลประโยคตัวอย่างภาษาไทย"
}

กฎ:
- คำศัพท์ต้องสะกดอย่างถูกต้อง
- ประโยคตัวอย่างต้องใช้คำศัพท์นั้นในรูปคำที่เหมาะสม
- ห้ามมีฟอร์แมตอื่นใดนอกเหนือจาก JSON object ดังกล่าว`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.85,
    max_tokens: 800,
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("Empty response from OpenAI");
  }

  const vocab = JSON.parse(raw);

  // Validate structure
  if (
    !vocab.word ||
    !vocab.partOfSpeech ||
    !vocab.pronunciation ||
    !vocab.translation ||
    !vocab.exampleEng ||
    !vocab.exampleThai
  ) {
    throw new Error("Invalid vocabulary structure: " + raw);
  }

  return vocab;
}

/**
 * Generates and sends a single vocabulary word to a specific user.
 * Resets their lastVocabAt timer.
 */
export async function sendIndividualVocabulary(chatId: string): Promise<boolean> {
  try {
    // ─── Fetch Recent Vocabulary (per-user) to Prevent Repeats ────
    let pastWords: string[] = [];
    try {
      const historySnapshot = await db
        .collection("vocabulary_history")
        .where("chatId", "==", chatId)
        .orderBy("sentAt", "desc")
        .limit(100) // Increase limit to better filter duplicates
        .get();
      if (!historySnapshot.empty) {
        pastWords = historySnapshot.docs.map((doc) => doc.data().word.trim().toLowerCase());
      }
    } catch (err) {
      console.error("Failed to fetch vocabulary history:", err);
    }

    let vocab: any = null;

    // ─── Try to fetch from the Global Vocabulary Pool ───
    try {
      const poolSnapshot = await db.collection("global_vocabulary").get();
      if (!poolSnapshot.empty) {
        const candidates = poolSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        // Filter out words that this user has already received
        const available = candidates.filter((item: any) => {
          return item.word && !pastWords.includes(item.word.trim().toLowerCase());
        });

        if (available.length > 0) {
          // Select a random word from available pool items
          const randomIndex = Math.floor(Math.random() * available.length);
          vocab = available[randomIndex];
          console.log(`User ${chatId}: Selected vocab "${vocab.word}" from global pool.`);
        }
      }
    } catch (poolErr) {
      console.error("Failed to query vocabulary pool:", poolErr);
    }

    // ─── Fallback to OpenAI if no pool word is available ───
    if (!vocab) {
      console.log(`User ${chatId}: No available pool words, generating via OpenAI fallback.`);
      vocab = await generateOnTheFly(pastWords);
    }

    // ─── Format HTML Message ──────────────────────────
    const messageText = `📖 <b>คำศัพท์ประจำชั่วโมง (Oxford 3000)</b>
 
🇺🇸 <b>${vocab.word}</b> (${vocab.partOfSpeech})
🔊 <b>คำอ่าน:</b> ${vocab.pronunciation}
💡 <b>ความหมาย:</b> ${vocab.translation}

📝 <b>ประโยคตัวอย่าง:</b>
• <i>${vocab.exampleEng}</i>
• ${vocab.exampleThai}

✨ <i>หมั่นทบทวนวันละนิดเพื่อเตรียมตัวสอบนะครับ!</i>`;

    // ─── Send to User ───────────────────────────────
    await sendMessage(chatId, messageText, "HTML");

    // ─── Update User Timer ───────────────────────────
    await db.collection("users").doc(chatId).update({
      lastVocabAt: new Date(),
    });

    // ─── Log to History ──────────────────────────────
    try {
      await db.collection("vocabulary_history").add({
        word: vocab.word,
        partOfSpeech: vocab.partOfSpeech,
        pronunciation: vocab.pronunciation,
        translation: vocab.translation,
        exampleEng: vocab.exampleEng,
        exampleThai: vocab.exampleThai,
        sentAt: new Date(),
        chatId,
      });
    } catch (dbErr) {
      console.error("Failed to write to vocabulary_history:", dbErr);
    }

    return true;
  } catch (error) {
    console.error(`sendIndividualVocabulary error for user ${chatId}:`, error);
    return false;
  }
}
