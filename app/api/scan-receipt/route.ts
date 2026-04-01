import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';

const CATEGORY_MAPPING_PROMPT = `You are a smart expense categorizer for a personal finance app.

Given a receipt image (photo, screenshot from Apple Pay, Google Pay, bank notification, etc.), extract expense information and categorize it.

Available expense categories:
- "Groceries" — supermarket purchases, household supplies, cleaning products, shampoo, toiletries, food from grocery stores
- "Dining Out" — restaurant bills, cafe bills, fast food, takeout, any restaurant or food establishment purchase (this is "outside food")
- "Transportation" — gas, uber, lyft, bus, train, parking, tolls, car maintenance
- "Utilities" — electricity, water, gas bills, internet, phone bills
- "Rent/Mortgage" — rent payments, mortgage payments
- "Healthcare" — pharmacy, doctor visits, medical bills, prescriptions
- "Entertainment" — movies, streaming services, games, concerts, subscriptions
- "Shopping" — clothing, electronics, online shopping, Amazon purchases
- "Travel" — flights, hotels, airbnb, vacation expenses
- "Education" — courses, books, tuition, school supplies
- "Insurance" — health insurance, car insurance, home insurance
- "Other Expenses" — anything that doesn't fit the above categories

Item categorization rules:
- Shampoo, soap, toothpaste, cleaning supplies → "Groceries"
- Beef, chicken, meat, produce from a grocery store → "Groceries"
- Any restaurant/cafe/fast food receipt → "Dining Out"
- Apple Pay / Google Pay / bank notifications: determine from merchant name and items

Respond ONLY with valid JSON in this exact format (no markdown, no backticks):
{
  "merchant": "Store or merchant name",
  "date": "YYYY-MM-DD",
  "totalAmount": 0.00,
  "category": "One of the exact category names listed above",
  "items": [
    { "name": "item name", "amount": 0.00, "suggestedCategory": "category name" }
  ],
  "notes": "Brief description of the purchase",
  "tags": ["relevant", "tags"],
  "confidence": "high" | "medium" | "low"
}

If you cannot read the receipt clearly, still provide your best guess with confidence "low".
If the image is not a receipt at all, return:
{ "error": "This does not appear to be a receipt or payment screenshot" }`;

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY is not configured. Add it to your .env.local file.' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { image, mimeType } = body;

    if (!image) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const base64Data = image.includes('base64,') ? image.split('base64,')[1] : image;

    const result = await model.generateContent([
      CATEGORY_MAPPING_PROMPT,
      {
        inlineData: {
          data: base64Data,
          mimeType: mimeType || 'image/jpeg',
        },
      },
    ]);

    const responseText = result.response.text();

    const cleanedText = responseText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    const parsed = JSON.parse(cleanedText);

    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: 422 });
    }

    return NextResponse.json({ success: true, data: parsed });
  } catch (error) {
    console.error('Receipt scan error:', error);
    const message = error instanceof Error ? error.message : 'Failed to scan receipt';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
