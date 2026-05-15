import { GoogleGenAI } from "@google/genai";

const apiKey = (typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : '') || "";
if (!apiKey) {
  console.warn("GEMINI_API_KEY is missing in the client environment. AI features will fail.");
}
const ai = new GoogleGenAI({ apiKey });

export async function summarizeTicket(content: string) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `請摘要以下 Zendesk 工單內容，列出重點。最後另外提供一個專業且禮貌的回覆建議。
      
      內容：
      ${content}`,
    });
    
    return response.text;
  } catch (error) {
    console.error("Gemini Error:", error);
    return "無法生成摘要。請檢查 API Key 或內容。";
  }
}

export async function suggestReply(content: string, customPrompt?: string) {
  try {
    const prompt = customPrompt 
      ? `${customPrompt}\n\n內容：\n${content}`
      : `根據以下對話內容，提供一個專業、友善且有幫助的回覆。請使用繁體中文。
      
      內容：
      ${content}`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
    
    return response.text;
  } catch (error) {
    console.error("Gemini Error:", error);
    return "無法生成回覆建議。";
  }
}

export async function suggestChatReply(lastMessages: string) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `這是一個即時對話的內容。請根據用戶最後的訊息，生成 3 個簡短、快速回覆的範本。
      
      對話內容：
      ${lastMessages}`,
    });
    
    return response.text;
  } catch (error) {
    console.error("Gemini Error:", error);
    return "無法生成聊天回覆。";
  }
}
